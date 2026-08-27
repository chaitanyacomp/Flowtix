import * as React from "react";
import { Keyboard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ApiRequestError, apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { DecimalInput } from "../components/ui/DecimalInput";
import { useAuth } from "../hooks/useAuth";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useDependentFieldFocus } from "../hooks/useDependentFieldFocus";
import { useMandatoryPositiveQtyDraft } from "../hooks/useMandatoryPositiveQtyDraft";
import { sanitizeProductionQtyDraftInput } from "../lib/quantityDraft";
import {
  OperatorMetricBadge,
  OperatorPageBody,
  OperatorTopBar,
  operatorInputClass,
} from "../components/erp/OperatorWorkbench";
import { cn } from "../lib/utils";
import { ErpModal } from "../components/erp/ErpModal";
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
import { NoQtyCycleContextBar } from "../components/erp/foundation/NoQtyCycleContextBar";
import { ErpPageLoader } from "../components/erp/foundation/ErpPageLoader";
import { OperationalContextBar, OperationalContextSticky, OpCtxSep } from "../components/erp/OperationalWorkspaceChrome";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useListScrollRestoration } from "../hooks/useListScrollRestoration";
import { buildNoQtyGuidedHref, buildQcEntryHref, useNoQtyFlowState } from "../lib/noQtyFlowState";
import { useToast } from "../contexts/ToastContext";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { DemoSafeNoQtyContinue } from "../components/demo/DemoSafeNoQtyContinue";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";
import { displayRequirementSheetNo, displaySalesOrderNo, displayWorkOrderNo, displayWorkOrderTraceNo } from "../lib/docNoDisplay";
import { productionFlowDisplayLabel } from "../lib/productionFlowPresentation";
import { useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { useErpRoleUi } from "../hooks/useErpRoleUi";
import { useCanCreateNextRs } from "../hooks/useIsAdmin";
import { getRoleEmptyState } from "../lib/erpRoleEmptyStates";
import { isProductionWorkspaceEntry } from "../lib/operationalPageEntry";
import {
  buildProductionWorkspaceListHref,
  productionHrefFromProductionWorkspace,
} from "../lib/manufacturingNavigationContinuity";
import { buildProductionWorkspaceOverviewHref } from "../lib/productionWorkspaceRouteContract";
import {
  isProductionReportCloseDecision,
  productionStageLabelForReportPending,
  shouldClearProductionReportTransition,
  shouldForceProductionReportTransition,
  shouldHideContinueWhileProductionReportPending,
  shouldIgnoreClearedExecutionSummaryDuringReportTransition,
} from "../lib/productionReportTransition";
import {
  computeReviewFinalizeShortageQty,
  isReviewFinalizeDispositionReady,
  REVIEW_FINALIZE_REMAINING_OPTIONS,
  reviewFinalizePrimaryButtonLabel,
  reviewFinalizeShortagePanelCopy,
  type ReviewFinalizeDisposition,
  type ReviewFinalizeFlowKind,
} from "../lib/productionReviewFinalizeDisposition";
import { buildProductionScopedHref } from "../lib/productionNavigation";
import {
  materialRequestsQueueHref,
  rmControlCenterHref,
} from "../lib/materialWorkflowLinks";
import { OperationalProductionWorkspace } from "../components/erp/OperationalProductionWorkspace";
import { resolveProductionWorkspaceRowAccess } from "../lib/productionWorkbenchCardNavigation";
import { ProductionWorkspaceStatusStrip } from "../components/erp/production/ProductionWorkspaceStatusStrip";
import { ProductionExecutionPanel } from "../components/erp/production/ProductionExecutionPanel";
import { ProductionReportPanel } from "../components/erp/production/ProductionReportPanel";
import { RegularSoEndProductionPanel } from "../components/erp/production/RegularSoEndProductionPanel";
import {
  fetchRegularSoDemandCoverage,
  requestRegularEndProduction,
} from "../lib/regularSoProductionClosureApi";
import {
  shouldHideRegularProductionEntryForReport,
  type RegularSoDemandCoverage,
} from "../lib/regularSoProductionClosureUx";
import { ProductionWorkspaceCompactPanel } from "../components/erp/production/ProductionWorkspaceCompactPanel";
import { ProductionRunStartConfirmPanel } from "../components/erp/production/ProductionRunStartConfirmPanel";
import { hasErpRole, PRODUCTION_WRITE_ROLES } from "../config/erpRoles";
import { ProductionRecentEntriesPanel } from "../components/erp/production/ProductionRecentEntriesPanel";
import { ProductionNoQtyOperatorContextBar } from "../components/erp/production/ProductionNoQtyOperatorContextBar";
import { ProductionNoQtyLoggingActionConsole } from "../components/erp/production/ProductionNoQtyLoggingActionConsole";
import { ProductionNoQtyWorkQueuePanel } from "../components/erp/production/ProductionNoQtyWorkQueuePanel";
import { ERPBackNavigation } from "../components/erp/foundation/ERPBackNavigation";
import type { ProductionRunStartEntryGate } from "../components/erp/production/ProductionRunStartConfirmPanel";
import {
  fetchOpenShiftSession,
  fetchShiftSession,
  SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE,
} from "../lib/machineShiftSessionApi";
import {
  shouldEmbedNoQtyRecentEntriesInLoggingWorkbench,
  shouldShowNoQtyOperatorWorkstationChrome,
  shouldShowProductionWorkspaceCompactLayout,
  shouldUseGreenLevelPremiumViewportWorkspace,
  shouldUseNoQtyPremiumViewportWorkspace,
  shouldUseProductionPageNaturalScroll,
} from "../lib/productionWorkspaceCompactUx";
import {
  hasPendingShortfallDecision,
  hasPausedShortfallDecision,
  shouldBlockNoQtyProductionEntry,
  shouldShowNoQtyContinueProductionCta,
  type ProductionExecutionClosedOutcome,
} from "../lib/productionCompletionUx";
import {
  buildPostProductionReportCloseHref,
  buildProductionCloseSuccessToast,
  shouldRedirectLegacyOrphanNoQtyProductionSearch,
} from "../lib/productionCloseCompletionUx";
import {
  coerceExecutionSummaryForWorkOrder,
  executionSummaryMatchesWorkOrder,
  isScopedWorkOrderClosed,
  resolveStaleScopedProductionNavigation,
  scopedProductionWorkspaceKey,
  scopedWorkOrderHasProducibleLine,
  shouldHideNoQtyAddProductionEntry,
  shouldShowScopedProductionReport,
  type NoQtyLineProducibility,
} from "../lib/productionScopedWorkspaceState";
import type { ProductionExecutionSummary } from "../lib/productionExecutionApi";
import {
  resolveUseRemainingQtyFill,
  shouldHoldProductionIdentityUnresolved,
  productionScopedUrlAlreadyMatches,
  buildRegularExecutableProductionSearch,
  shouldAutoOpenExecutableFromProductionWorkspaceList,
  resolveProductionRegularBack,
  appendProductionNavHistory,
  detectProductionNavOscillation,
  shouldHideEnterProductionCtaInEntryWorkspace,
  shouldSuppressRecordProductionPrimaryStrip,
  PRODUCTION_ENTRY_AWAIT_RUN_CONFIRM_MESSAGE,
} from "../lib/productionNavigationStability";
import {
  resolveRegularSoProductionDraftProjection,
  shouldShowUnusedRmReturnPrimaryStrip,
  sumReturnableRmQty,
} from "../lib/regularSoProductionDraftProjection";
import {
  isRegularProductionEntryBlocked,
  resolveRegularRmAllowedNowQty,
  resolveRegularRmEntryQtyCap,
  type ProductionRmReadiness,
} from "../components/erp/ProductionRmReadinessStrip";
import { ProductionRmConsumptionReviewModal } from "../components/erp/ProductionRmConsumptionReviewModal";
import type { DashboardProductionStatusSource } from "../lib/dashboardProductionStatus";
import {
  resolveNoQtyCycleDisplayStatus,
  resolveNoQtyCycleDisplayStatusForWorkOrder,
} from "../lib/noQtyCycleDisplayStatus";
import { PRODUCTION_QA_TERMS } from "../lib/productionQaTerminology";
import {
  noQtyErpAdjustedPlanningQtyForWorkOrder,
  noQtyOperatorPendingQtyForWorkOrder,
} from "../lib/noQtyShortagePresentation";
import {
  isWorkOrderPausedStatus,
  isWorkOrderProductionBlocked,
  resumeWorkOrderApi,
  workOrderProductionBlockedMessage,
  workOrderStatusDisplayLabel,
} from "../lib/workOrderLifecycle";
import {
  buildProductionQaHandoffStep,
  buildRmIssueNextStep,
  buildRmReadyProductionNextStep,
  productionRoleCanOpenQaWorkspace,
  resolveProductionStickyContext,
  resolveProductionStickyMetrics,
} from "../lib/regularSoOperationalGuidance";
import { bumpErpRefresh } from "../lib/erpRefresh";
import {
  ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS,
  resolveActiveShiftWorkspaceCueFromGate,
} from "../lib/activeShiftRunGuidance";
import { evaluateOpenShiftOverdue, SHIFT_OVERDUE_MESSAGE } from "../lib/shiftOverdueGuidance";
import {
  PRODUCTION_REPORT_CONFIRM_REFRESH_SCOPES,
  buildProductionQueueLines,
  buildQcPendingByWorkOrderLineId,
  hasExecutableProductionWork,
  pickFirstExecutableProductionLine,
  resolvePostProductionReportConfirmAdvance,
  resolvePostProductionPauseAdvance,
  sortProductionLinesFifo,
} from "../lib/productionWorkspaceQueue";
import {
  inferProductionFlowFromLegacy,
  parseProductionFlowParam,
  PRODUCTION_FLOW_GREEN_LEVEL,
  PRODUCTION_FLOW_NO_QTY,
  PRODUCTION_FLOW_REGULAR,
  GREEN_LEVEL_STOCK_SOURCE_LABEL,
  GREEN_LEVEL_CUSTOMER_DISPLAY_LABEL,
  validateProductionFlowVsOrderType,
  isGreenLevelReplenishmentSourceType,
  type ProductionFlowParam,
} from "../lib/productionFlowContract";
import {
  buildGreenLevelProductionQueueRows,
  filterGreenLevelExecutableWorkOrders,
  greenLevelRowAllowsProductionEntry,
  greenLevelRowShowsQcWaiting,
  isGreenLevelProductionEntry,
  productionEntryUsesRmConsumptionReview,
  type GreenLevelProductionQueueRow,
} from "../lib/greenLevelProductionExecution";
import { GreenLevelProductionWorkQueuePanel } from "../components/erp/production/GreenLevelProductionWorkQueuePanel";
import { GreenLevelProductionCurrentWoCard } from "../components/erp/production/GreenLevelProductionCurrentWoCard";
import { GreenLevelProductionWoSwitchDialog } from "../components/erp/production/GreenLevelProductionWoSwitchDialog";
import {
  clearProductionReportDraft,
  isProductionReportDraftDirty,
} from "../lib/productionReportDraftCache";
import { ProductionConciseRmStatus } from "../components/erp/production/ProductionConciseRmStatus";
import { ProductionFlowIdentityBar } from "../components/erp/production/ProductionFlowIdentityBar";
import { ProductionOperatorIdentityBar } from "../components/erp/production/ProductionOperatorIdentityBar";
import {
  ProductionOperatorEntryFields,
  ProductionOperatorEntryShell,
} from "../components/erp/production/ProductionOperatorEntryShell";
import { ProductionOperatorWorkbench } from "../components/erp/production/ProductionOperatorWorkbench";
import {
  ProductionOperatorOpenWoQueue,
  type ProductionOperatorOpenWoRow,
} from "../components/erp/production/ProductionOperatorOpenWoQueue";
import {
  formatProductionQtyForInput,
  productionOperatorQtyPlaceholder,
  resolveProductionEntryMaxQty,
} from "../lib/productionOperatorUx";
import { NoQtyMacroLifecycleStrip } from "../components/erp/production/NoQtyMacroLifecycleStrip";
import { deriveProductionConciseRmLabel } from "../lib/productionRmConciseStatus";
import {
  PRODUCTION_QUANTITY_COMPLETED_MESSAGE,
  resolveProductionEntryCapacityPhase,
} from "../lib/productionEntryCapacityUx";
import { formatFgQuantity, formatRmQuantity } from "../lib/quantityDisplay";
import { parseProductionWorkspaceBucket } from "../lib/productionWorkspaceBucketFilter";
import {
  buildProductionQueueByLineId,
  buildReadinessSeedFromQueueRow,
  deriveConciseRmLabelFromQueueRow,
  isQueueRmReadinessSufficient,
} from "../lib/productionWorkspaceReadinessUx";

function openWoQueueStatusLabel(rem: number, queueStatus?: string): string {
  if (queueStatus === "qc_pending") return "QC pending";
  if (queueStatus === "carry_forward") return "Carry forward";
  return rem <= 1e-6 ? "Complete" : "In progress";
}

type WoLine = {
  id: number;
  fgItemId: number;
  qty: string;
  /** Authoritative WO plan when present (else `qty`). */
  plannedQty?: string | number | null;
  /** Sum of APPROVED production batches on this line (draft excluded). */
  approvedProducedQty?: number;
  /** max(0, WO planned − approved produced); lines with 0 are omitted when pendingOnly=1. */
  remainingQty?: number;
  qcPendingQty?: number;
  fgItem: { itemName: string; unit?: string };
};
type WoRow = {
  id: number;
  salesOrderId: number;
  docNo?: string | null;
  status?: string;
  sourceType?: string | null;
  holdReason?: string | null;
  holdRemarks?: string | null;
  shortfallQty?: number | string | null;
  closureReason?: string | null;
  requirementSheetId?: number | null;
  cycleId?: number | null;
  cycle?: { cycleNo?: number | null; id?: number | null } | null;
  /** Present when `salesOrder: true` on work-orders API. */
  salesOrder?: { orderType?: string | null; docNo?: string | null } | null;
  productionExecution?: { executionStatus?: string | null } | null;
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
  /** Soft link to open Machine Shift Session (server-resolved). */
  shiftLink?: {
    linked?: boolean;
    shiftSessionId?: number | null;
    shiftSessionNo?: string | null;
    shiftRunSegmentId?: number | null;
    shiftRunSegmentLabel?: string | null;
  } | null;
  workOrderLine: {
    id: number;
    fgItem: { itemName: string; unit?: string };
    workOrder: {
      id: number;
      salesOrderId: number;
      sourceType?: string | null;
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

/** REGULAR (non–NO_QTY, non–GL) batches use RM consumption review before approve (Phase 3E). */
function entryUsesRmConsumptionReview(e: ProdEntryRow | undefined): boolean {
  return productionEntryUsesRmConsumptionReview(e);
}


/** REGULAR flow only — smart back targets from explicit `from` / `source` (UI navigation). */
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

type NoQtyRsListRow = {
  id: number;
  cycleId: number | null;
  cycleNo: number | null;
  status: string;
};

type NoQtyRsDisplayLine = {
  itemId: number;
  itemName: string;
  newRequirement: number;
  lastShortageAdded: number;
  finalPlannedQty: number;
  coveredFromStockQty: number;
};

type NoQtyShortageHistorySheet = {
  sheetId: number;
  cycleId: number | null;
  cycleNo: number | null;
  lines: NoQtyRsDisplayLine[];
};

type NoQtyProductShortageHistoryRow = {
  key: string;
  cycleId: number | null;
  cycleNo: number | null;
  itemId: number;
  itemName: string;
  newRequirement: number;
  lastShortageAdded: number;
  finalPlannedQty: number;
  producedQty: number;
  shortageQty: number;
  isCurrentCycle: boolean;
};

function safeProdNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function linePlannedQty(l: Pick<FlatLine, "qty" | "plannedQty">): number {
  const planned = Number(l.plannedQty ?? l.qty);
  return Number.isFinite(planned) ? planned : 0;
}

function lineRemaining(l: FlatLine): number {
  const approved = l.approvedProducedQty ?? 0;
  return l.remainingQty != null && Number.isFinite(l.remainingQty)
    ? l.remainingQty
    : Math.max(0, linePlannedQty(l) - approved);
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
  return `${displayWorkOrderNo(w.id, w.docNo ?? null)} | ${displaySalesOrderNo(soId, soDoc)} | ${cyc}`;
}

function cycleNoForWorkOrder(workOrders: WoRow[], workOrderId: number): number | null {
  const wo = workOrders.find((w) => w.id === workOrderId);
  const n = wo?.cycle?.cycleNo;
  return n != null && Number.isFinite(Number(n)) ? Number(n) : null;
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

type ProductionFlowMode = "NO_QTY" | "REGULAR" | "GREEN_LEVEL" | "NONE";

function formatNoQtyProductionEntryContextLine(opts: {
  cycleNo: number | null;
  workOrderId: number;
  woDocNo?: string | null;
  requirementSheetId?: number | null;
  itemName: string;
  remainingQty: number;
  unit?: string | null;
}): string {
  const cycle =
    opts.cycleNo != null && Number.isFinite(Number(opts.cycleNo)) ? `Cycle ${Number(opts.cycleNo)}` : "Cycle —";
  const wo = displayWorkOrderNo(opts.workOrderId, opts.woDocNo ?? null);
  const rs =
    opts.requirementSheetId != null && Number(opts.requirementSheetId) > 0
      ? displayRequirementSheetNo(Number(opts.requirementSheetId), null)
      : "RS —";
  return `${cycle} · ${wo} · ${rs} · ${opts.itemName} · Remaining ${formatFgQuantity(opts.remainingQty, opts.unit)}`;
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
  useListScrollRestoration();
  const roleUi = useErpRoleUi();
  const canCreateNextRs = useCanCreateNextRs();
  const canProd = auth.user?.role === "ADMIN" || auth.user?.role === "PRODUCTION";
  const canConfirmProductionStart = hasErpRole(auth.user?.role, PRODUCTION_WRITE_ROLES);
  const operatorRole = auth.user?.role ?? "";
  const [selectedRunAllocationId, setSelectedRunAllocationId] = React.useState<number | null>(null);
  const [runStartEntryGate, setRunStartEntryGate] = React.useState<ProductionRunStartEntryGate>({
    mode: null,
    loading: false,
    confirmedRunCount: 0,
    entryBlocked: false,
    selectedMachineId: null,
  });
  const onRunStartEntryGateChange = React.useCallback((gate: ProductionRunStartEntryGate) => {
    setRunStartEntryGate(gate);
  }, []);
  const runStartEntryBlocked = Boolean(runStartEntryGate.entryBlocked);
  const canOpenQaFromProduction = productionRoleCanOpenQaWorkspace(operatorRole);
  const isAdmin = auth.user?.role === "ADMIN";
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const demo = useDemoMode();
  const prodDemoHl =
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "regular", 3) ??
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "no_qty", 4);
  const showDemoNoQtyProdContinue = demo.enabled && demo.flow === "no_qty" && demo.step === 4;
  const liveTick = useErpRefreshTick(["production", "qc", "dashboard", "reports"], { pollIntervalMs: 0 });

  const source = searchParams.get("source") ?? "";
  const fromParam = searchParams.get("from") ?? "";
  const fromStepParam = searchParams.get("fromStep") ?? "";
  const fromPendingActions = fromParam === "pending-actions";
  const productionBucketFilter = parseProductionWorkspaceBucket(searchParams.get("productionBucket"));
  const flowParam = parseProductionFlowParam(searchParams.get("flow"));
  const fromNoQtySo = source === "no_qty_so" || flowParam === PRODUCTION_FLOW_NO_QTY;
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
  const runAllocationIdFromUrl = Number(searchParams.get("runAllocationId") ?? 0);
  const shiftSessionIdFromUrl = Number(searchParams.get("shiftSessionId") ?? 0);
  const runSegmentIdFromUrl = Number(searchParams.get("runSegmentId") ?? 0);
  const machineIdFromUrl = Number(searchParams.get("machineId") ?? 0);
  const focusConfirmStartFromUrl = searchParams.get("focusConfirmStart") === "1";
  const focusRecordProductionFromUrl = searchParams.get("focusRecordProduction") === "1";
  const activeShiftDeepLink =
    (Number.isFinite(shiftSessionIdFromUrl) && shiftSessionIdFromUrl > 0) ||
    (Number.isFinite(runAllocationIdFromUrl) && runAllocationIdFromUrl > 0);
  const woIdFromUrlPick =
    Number.isFinite(woIdFromWorkOrderParam) && woIdFromWorkOrderParam > 0
      ? woIdFromWorkOrderParam
      : Number.isFinite(woIdFromLegacy) && woIdFromLegacy > 0
        ? woIdFromLegacy
        : 0;
  const woIdFromUrlValid = woIdFromUrlPick > 0;
  const workOrderLineIdFromUrlValid =
    Number.isFinite(workOrderLineIdFromUrl) && workOrderLineIdFromUrl > 0;
  /** Deep-link WO/line in URL — authoritative; auto-pick and clear effects must not override. */
  const urlWoSelectionAuthority = woIdFromUrlValid || workOrderLineIdFromUrlValid;
  /**
   * Scoped shop-floor target in URL — not left-menu / Pending Actions overview.
   * `from=pending-actions` alone (with optional productionBucket) is an unscoped overview;
   * only WO/SO/flow pins force scoped mode.
   */
  const productionScopedDeepLink =
    searchParams.get("fromDashboard") === "1" ||
    urlWoSelectionAuthority ||
    focusSoIdValid ||
    fromNoQtySo;

  React.useEffect(() => {
    if (Number.isFinite(runAllocationIdFromUrl) && runAllocationIdFromUrl > 0) {
      setSelectedRunAllocationId(runAllocationIdFromUrl);
    }
  }, [runAllocationIdFromUrl]);

  const activeShiftRunDeepLink =
    activeShiftDeepLink &&
    woIdFromUrlValid &&
    (focusConfirmStartFromUrl || focusRecordProductionFromUrl);
  const activeShiftWorkspaceCue = resolveActiveShiftWorkspaceCueFromGate({
    loading: runStartEntryGate.loading,
    entryBlocked: runStartEntryBlocked,
    confirmedRunCount: runStartEntryGate.confirmedRunCount,
    focusConfirmStart: focusConfirmStartFromUrl,
    focusRecordProduction: focusRecordProductionFromUrl,
  });
  const autoOpenConfirmStart =
    focusConfirmStartFromUrl && !runStartEntryGate.loading && runStartEntryBlocked;

  const [workOrders, setWorkOrders] = React.useState<WoRow[]>([]);
  const [entries, setEntries] = React.useState<ProdEntryRow[]>([]);
  const [woId, setWoId] = React.useState(0);
  const [wolId, setWolId] = React.useState(0);
  const woIdRef = React.useRef(0);
  const wolIdRef = React.useRef(0);
  woIdRef.current = woId;
  wolIdRef.current = wolId;
  const urlWoSelectionAuthorityRef = React.useRef(urlWoSelectionAuthority);
  urlWoSelectionAuthorityRef.current = urlWoSelectionAuthority;
  const urlSelectionAppliedRef = React.useRef(false);
  /** After explicit Back to workspace list — block auto-open / stale reopen until user picks a WO. */
  const suppressWorkspaceAutoOpenRef = React.useRef(false);
  const productionNavGenerationRef = React.useRef(0);
  const productionNavHistoryRef = React.useRef<string[]>([]);
  const backToWorkspaceBusyRef = React.useRef(false);
  const [backToWorkspaceBusy, setBackToWorkspaceBusy] = React.useState(false);
  /** Locked when operator picks a work-queue row (menu entry); prevents NO_QTY/REGULAR layout oscillation. */
  const [userLockedFlowMode, setUserLockedFlowMode] = React.useState<ProductionFlowMode | null>(null);
  const [soOrderTypeById, setSoOrderTypeById] = React.useState<Record<number, string>>({});
  /**
   * Flips to true once the initial WO/entries `refresh()` settles (success or failure).
   * Lets `productionIdentityUnresolved` distinguish "WO not loaded yet" from "WO not in
   * pending list", which is critical to avoid blocking REGULAR flow indefinitely when the
   * URL references a completed/non-pending WO id.
   */
  const [initialRefreshDone, setInitialRefreshDone] = React.useState(false);
  const [executionPanelRefreshTick, setExecutionPanelRefreshTick] = React.useState(0);
  const [noQtyExecutionSummary, setNoQtyExecutionSummary] = React.useState<ProductionExecutionSummary | null>(null);
  const [regularSoCoverage, setRegularSoCoverage] = React.useState<RegularSoDemandCoverage | null>(null);
  const [regularEndProductionBusy, setRegularEndProductionBusy] = React.useState(false);
  const resetScopedProductionWorkspaceState = React.useCallback(() => {
    setNoQtyExecutionSummary(null);
    setRegularSoCoverage(null);
    setCompletionEvaluateTick(0);
    setCompletionEvaluateBatchQty(0);
    setEditing(null);
    setExecutionPanelRefreshTick((t) => t + 1);
  }, []);
  const handleScopedExecutionSummaryChange = React.useCallback(
    (summary: ProductionExecutionSummary | null, scopedWorkOrderId: number) => {
      if (summary && scopedWorkOrderId > 0 && !executionSummaryMatchesWorkOrder(summary, scopedWorkOrderId)) {
        return;
      }
      setNoQtyExecutionSummary(summary);
    },
    [],
  );
  const [completionEvaluateTick, setCompletionEvaluateTick] = React.useState(0);
  const [completionEvaluateBatchQty, setCompletionEvaluateBatchQty] = React.useState(0);
  const productionCloseReturnTimerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (productionCloseReturnTimerRef.current != null) {
        window.clearTimeout(productionCloseReturnTimerRef.current);
      }
    },
    [],
  );

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

  /** NO_QTY shop-floor continue from dashboard / guided deep-link — not REGULAR or GL WO. */
  const noQtyContinueProductionIntent =
    fromNoQtySo ||
    noQtyRecoveryFromSelectedWo ||
    noQtyRecoveryFromEntries ||
    (fromPendingActions && (focusSoIdValid || woIdFromUrlValid || workOrderLineIdFromUrlValid)) ||
    (focusSoIdValid &&
      String(soOrderTypeById[focusSoId] ?? "") === "NO_QTY" &&
      (searchParams.get("fromDashboard") === "1" || urlWoSelectionAuthority));

  /**
   * URL-only NO_QTY identity (never inferred from menu WO selection alone — that uses productionFlowMode).
   */
  const explicitNoQtyUrlNavigate =
    (focusSoIdValid &&
      (fromNoQtySo || fromPendingActions || String(soOrderTypeById[focusSoId] ?? "") === "NO_QTY")) ||
    noQtyRecoveryFromSelectedWo ||
    noQtyRecoveryFromEntries ||
    (fromPendingActions && (woIdFromUrlValid || workOrderLineIdFromUrlValid));

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
    const wo = woIdFromUrlValid ? workOrders.find((w) => w.id === woIdFromUrlPick) : null;
    const woSalesOrderId = wo && wo.salesOrderId > 0 ? wo.salesOrderId : null;
    return shouldHoldProductionIdentityUnresolved({
      fromNoQtySo,
      explicitNoQtyUrlNavigate,
      flowParam,
      focusSoIdValid,
      focusSoId,
      soOrderTypeKnown: focusSoIdValid
        ? Object.prototype.hasOwnProperty.call(soOrderTypeById, focusSoId)
        : true,
      woIdFromUrlValid,
      initialRefreshDone,
      woSalesOrderId,
      woSoOrderTypeKnown:
        woSalesOrderId != null
          ? Object.prototype.hasOwnProperty.call(soOrderTypeById, woSalesOrderId)
          : true,
      woIsGreenLevel: Boolean(wo && isGreenLevelReplenishmentSourceType(wo.sourceType)),
      regularFlowToken: PRODUCTION_FLOW_REGULAR,
      greenLevelFlowToken: PRODUCTION_FLOW_GREEN_LEVEL,
    });
  }, [
    fromNoQtySo,
    explicitNoQtyUrlNavigate,
    flowParam,
    focusSoIdValid,
    focusSoId,
    soOrderTypeById,
    woIdFromUrlValid,
    woIdFromUrlPick,
    workOrders,
    initialRefreshDone,
  ]);

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

  const [noQtyEmptyMsg, setNoQtyEmptyMsg] = React.useState<string>("");

  const [prodDate, setProdDate] = React.useState(todayYmd);
  const {
    raw: producedQtyStr,
    setRaw: setProducedQtyStr,
    parsed: producedQtyParsed,
    isValid: producedQtyValid,
    reset: resetProducedQty,
  } = useMandatoryPositiveQtyDraft();
  /** Prevents async line prefill / RM clamp from overwriting manual qty entry. */
  const producedQtyUserTouchedRef = React.useRef(false);
  /** Current FG UOM for qty sanitization (selected line may be declared later in this component). */
  const producedQtyUnitRef = React.useRef<string | null>(null);
  const resetProducedQtyField = React.useCallback(() => {
    producedQtyUserTouchedRef.current = false;
    resetProducedQty();
  }, [resetProducedQty]);
  const onProducedQtyInputChange = React.useCallback(
    (raw: string) => {
      producedQtyUserTouchedRef.current = true;
      setProducedQtyStr(sanitizeProductionQtyDraftInput(raw, producedQtyUnitRef.current));
    },
    [setProducedQtyStr],
  );
  const [posting, setPosting] = React.useState(false);
  /** Last create response shift link — shown until entries refresh supplies shiftLink. */
  const [lastCreatedShiftLink, setLastCreatedShiftLink] = React.useState<ProdEntryRow["shiftLink"]>(null);

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
  const [editQty, setEditQty] = React.useState("");
  const [editDate, setEditDate] = React.useState(todayYmd);
  const [editSaving, setEditSaving] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<number | null>(null);
  const [reverseModalEntry, setReverseModalEntry] = React.useState<ProdEntryRow | null>(null);
  const [consumptionApproveId, setConsumptionApproveId] = React.useState<number | null>(null);
  type RemainingDisposition = ReviewFinalizeDisposition;
  type ApprovalExtras = { remainingDisposition?: RemainingDisposition; pauseReason?: string; dispositionRemarks?: string | null };
  const [consumptionApprovalExtras, setConsumptionApprovalExtras] = React.useState<ApprovalExtras>({});
  const [reviewFinalizeEntryId, setReviewFinalizeEntryId] = React.useState<number | null>(null);
  /** Null until the operator deliberately chooses Pause or End — never preselect Continue/Pause. */
  const [reviewDisposition, setReviewDisposition] = React.useState<RemainingDisposition | null>(null);
  const [reviewPauseReason, setReviewPauseReason] = React.useState("MACHINE_BREAKDOWN");
  const [reviewRemarks, setReviewRemarks] = React.useState("");
  const [reviewPermanentClosureAcknowledged, setReviewPermanentClosureAcknowledged] = React.useState(false);
  /** Sticky gate: End/Equal/Extra finalize → report. Blocks Continue/runner flash until report layout mounts. */
  const [productionReportTransitionWoId, setProductionReportTransitionWoId] = React.useState(0);
  const productionReportTransitionWoIdRef = React.useRef(0);
  React.useEffect(() => {
    productionReportTransitionWoIdRef.current = productionReportTransitionWoId;
  }, [productionReportTransitionWoId]);
  const [reverseQtyDraft, setReverseQtyDraft] = React.useState("");
  const [reverseReasonDraft, setReverseReasonDraft] = React.useState("");
  const [reverseModalError, setReverseModalError] = React.useState<string | null>(null);
  const [entryFilter, setEntryFilter] = React.useState<"ALL" | "DRAFT" | "APPROVED">("ALL");
  const [noQtyRmShortage, setNoQtyRmShortage] = React.useState<NoQtyRmShortagePayload | null>(null);
  const noQtyContinueAutoPickDoneRef = React.useRef(false);

  React.useEffect(() => {
    noQtyContinueAutoPickDoneRef.current = false;
    urlSelectionAppliedRef.current = false;
  }, [focusSoId, woIdFromUrlPick, workOrderLineIdFromUrl]);

  const clearWoLineSelection = React.useCallback((opts?: { force?: boolean }) => {
    if (!opts?.force && urlWoSelectionAuthorityRef.current) return;
    setWoId((prev) => (prev !== 0 ? 0 : prev));
    setWolId((prev) => (prev !== 0 ? 0 : prev));
    setUserLockedFlowMode(null);
    resetProducedQtyField();
  }, [resetProducedQtyField]);

  React.useEffect(() => {
    if (urlWoSelectionAuthority) {
      suppressWorkspaceAutoOpenRef.current = false;
    }
  }, [urlWoSelectionAuthority]);

  /** Left-menu / PA overview: drop stale WO selection so Active Production is primary. */
  React.useEffect(() => {
    const overview =
      !urlWoSelectionAuthority &&
      !focusSoIdValid &&
      !fromNoQtySo &&
      searchParams.get("fromDashboard") !== "1";
    if (!overview) return;
    if (woId === 0 && wolId === 0 && userLockedFlowMode == null) {
      urlSelectionAppliedRef.current = false;
      return;
    }
    clearWoLineSelection({ force: true });
    resetScopedProductionWorkspaceState();
    urlSelectionAppliedRef.current = false;
  }, [
    urlWoSelectionAuthority,
    focusSoIdValid,
    fromNoQtySo,
    searchParams,
    woId,
    wolId,
    userLockedFlowMode,
    clearWoLineSelection,
    resetScopedProductionWorkspaceState,
  ]);

  React.useEffect(() => {
    if (!woIdFromUrlValid || woIdFromUrlPick <= 0) return;
    const woRow = workOrders.find((w) => w.id === woIdFromUrlPick);
    const action = resolveStaleScopedProductionNavigation({
      urlWorkOrderId: woIdFromUrlPick,
      initialRefreshDone,
      workOrdersLoaded: workOrders.length > 0,
      workOrderExists: Boolean(woRow),
      workOrderStatus: woRow?.status ?? null,
    });
    if (action === "redirect_dashboard") {
      resetScopedProductionWorkspaceState();
      clearWoLineSelection({ force: true });
      navigate(
        buildPostProductionReportCloseHref({
          from: searchParams.get("from"),
          returnTo: searchParams.get("returnTo"),
          source: searchParams.get("source"),
        }),
        { replace: true },
      );
    }
  }, [
    woIdFromUrlValid,
    woIdFromUrlPick,
    initialRefreshDone,
    workOrders,
    navigate,
    resetScopedProductionWorkspaceState,
    clearWoLineSelection,
    searchParams,
  ]);

  /** Orphan NO_QTY URLs (no SO/WO) render the obsolete Select-WO screen — send them to Ready to Start. */
  React.useEffect(() => {
    if (!initialRefreshDone) return;
    if (!shouldRedirectLegacyOrphanNoQtyProductionSearch(searchParams)) return;
    navigate(
      buildPostProductionReportCloseHref({
        from: searchParams.get("from"),
        returnTo: searchParams.get("returnTo"),
        source: searchParams.get("source"),
      }),
      { replace: true },
    );
  }, [initialRefreshDone, searchParams, navigate]);

  const [noQtyShortageHistorySheets, setNoQtyShortageHistorySheets] = React.useState<NoQtyShortageHistorySheet[]>([]);
  const [noQtyShortageHistoryWorkOrders, setNoQtyShortageHistoryWorkOrders] = React.useState<WoRow[]>([]);
  const [noQtyShortageHistoryEntriesByCycle, setNoQtyShortageHistoryEntriesByCycle] = React.useState<
    Record<number, ProdEntryRow[]>
  >({});
  const [noQtyProductionQueue, setNoQtyProductionQueue] = React.useState<DashboardProductionStatusSource[]>([]);
  const productionQueueByLineId = React.useMemo(
    () => buildProductionQueueByLineId(noQtyProductionQueue),
    [noQtyProductionQueue],
  );

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

  /** WO/line identity from URL or operator selection — URL wins until state catches up. */
  const effectiveScopedWoId = React.useMemo(() => {
    if (woId > 0) return woId;
    if (woIdFromUrlValid) return woIdFromUrlPick;
    return 0;
  }, [woId, woIdFromUrlValid, woIdFromUrlPick]);

  const effectiveScopedWolId = React.useMemo(() => {
    if (wolId > 0) return wolId;
    if (workOrderLineIdFromUrlValid) return workOrderLineIdFromUrl;
    return 0;
  }, [wolId, workOrderLineIdFromUrlValid, workOrderLineIdFromUrl]);

  React.useEffect(() => {
    if (effectiveScopedWoId > 0) return;
    setSelectedRunAllocationId(null);
    setRunStartEntryGate({
      mode: null,
      loading: false,
      confirmedRunCount: 0,
      entryBlocked: false,
      selectedMachineId: null,
    });
  }, [effectiveScopedWoId]);

  const scopedExecutionSummary = React.useMemo(
    () => coerceExecutionSummaryForWorkOrder(noQtyExecutionSummary, effectiveScopedWoId),
    [noQtyExecutionSummary, effectiveScopedWoId],
  );
  const noQtyPendingShortfallDecision = hasPendingShortfallDecision(scopedExecutionSummary);
  const noQtyPausedShortfallDecision = hasPausedShortfallDecision(scopedExecutionSummary);
  const noQtyBlockProductionEntry = shouldBlockNoQtyProductionEntry(scopedExecutionSummary);
  const noQtyShowContinueProductionCta = shouldShowNoQtyContinueProductionCta(scopedExecutionSummary);
  const noQtyAllowShopFloorContinue = scopedExecutionSummary?.executionStatus === "RUNNING";

  const prevScopedWoRef = React.useRef(0);
  React.useEffect(() => {
    const id = effectiveScopedWoId;
    if (id > 0 && prevScopedWoRef.current > 0 && id !== prevScopedWoRef.current) {
      resetScopedProductionWorkspaceState();
      urlSelectionAppliedRef.current = false;
    } else if (id > 0) {
      setNoQtyExecutionSummary((prev) =>
        prev && !executionSummaryMatchesWorkOrder(prev, id) ? null : prev,
      );
    } else {
      setNoQtyExecutionSummary(null);
    }
    prevScopedWoRef.current = id;
  }, [effectiveScopedWoId, resetScopedProductionWorkspaceState]);

  const handleScopedWoExecutionSummaryChange = React.useCallback(
    (summary: ProductionExecutionSummary | null) => {
      if (
        shouldIgnoreClearedExecutionSummaryDuringReportTransition({
          transitionWorkOrderId: productionReportTransitionWoIdRef.current,
          summary,
        })
      ) {
        return;
      }
      handleScopedExecutionSummaryChange(summary, effectiveScopedWoId);
    },
    [handleScopedExecutionSummaryChange, effectiveScopedWoId],
  );

  const sortedFlatLines = React.useMemo(() => sortFlatByPriority(flatLines), [flatLines]);

  const flowResolutionSoId = React.useMemo(() => {
    if (focusSoIdValid) return focusSoId;
    if (woId > 0) {
      const w = workOrders.find((x) => x.id === woId);
      if (w && w.salesOrderId > 0) return w.salesOrderId;
    }
    if (wolId > 0) {
      const l = flatLines.find((x) => x.id === wolId);
      if (l && l.salesOrderId > 0) return l.salesOrderId;
    }
    if (woIdFromUrlValid) {
      const w = workOrders.find((x) => x.id === woIdFromUrlPick);
      if (w && w.salesOrderId > 0) return w.salesOrderId;
    }
    return 0;
  }, [focusSoIdValid, focusSoId, woId, wolId, flatLines, workOrders, woIdFromUrlValid, woIdFromUrlPick]);

  const productionFlowMode = React.useMemo((): ProductionFlowMode => {
    if (flowParam === PRODUCTION_FLOW_NO_QTY) return "NO_QTY";
    if (flowParam === PRODUCTION_FLOW_GREEN_LEVEL) return "GREEN_LEVEL";
    if (flowParam === PRODUCTION_FLOW_REGULAR) return "REGULAR";
    if (userLockedFlowMode) return userLockedFlowMode;
    if (fromNoQtySo) return "NO_QTY";
    if (noQtyRecoveryFromSelectedWo) return "NO_QTY";
    if (noQtyRecoveryFromEntries) return "NO_QTY";

    if (woIdFromUrlValid) {
      const wo = workOrders.find((w) => w.id === woIdFromUrlPick);
      if (wo) {
        if (isGreenLevelReplenishmentSourceType(wo.sourceType)) return "GREEN_LEVEL";
        if (!(Number(wo.salesOrderId) > 0)) return "REGULAR";
        if (Object.prototype.hasOwnProperty.call(soOrderTypeById, wo.salesOrderId)) {
          return String(soOrderTypeById[wo.salesOrderId] ?? "") === "NO_QTY" ? "NO_QTY" : "REGULAR";
        }
      }
    }

    if (noQtyContinueProductionIntent) return "NO_QTY";

    const soId = flowResolutionSoId;
    if (soId > 0 && Object.prototype.hasOwnProperty.call(soOrderTypeById, soId)) {
      return String(soOrderTypeById[soId] ?? "") === "NO_QTY" ? "NO_QTY" : "REGULAR";
    }

    const menuNeutral =
      !focusSoIdValid && !woIdFromUrlValid && !fromNoQtySo && !productionScopedDeepLink;
    if (menuNeutral && woId === 0 && wolId === 0) return "NONE";

    if (soId > 0 && !Object.prototype.hasOwnProperty.call(soOrderTypeById, soId)) return "NONE";

    if (woId === 0 && wolId === 0) return "NONE";

    return "REGULAR";
  }, [
    flowParam,
    userLockedFlowMode,
    fromNoQtySo,
    noQtyContinueProductionIntent,
    productionScopedDeepLink,
    noQtyRecoveryFromSelectedWo,
    noQtyRecoveryFromEntries,
    flowResolutionSoId,
    soOrderTypeById,
    focusSoIdValid,
    woIdFromUrlValid,
    woIdFromUrlPick,
    workOrders,
    woId,
    wolId,
  ]);

  const resolvedProductionFlow: ProductionFlowParam | null =
    productionFlowMode === "NO_QTY"
      ? PRODUCTION_FLOW_NO_QTY
      : productionFlowMode === "GREEN_LEVEL"
        ? PRODUCTION_FLOW_GREEN_LEVEL
        : productionFlowMode === "REGULAR"
          ? PRODUCTION_FLOW_REGULAR
          : null;

  const isNoQtyFlow = productionFlowMode === "NO_QTY";
  const isGreenLevelFlow = productionFlowMode === "GREEN_LEVEL";
  const useHardenedProductionShell = isNoQtyFlow || isGreenLevelFlow;
  const isRegularFlow = productionFlowMode === "REGULAR";

  React.useEffect(() => {
    if (!isRegularFlow || !(effectiveScopedWoId > 0)) {
      setRegularSoCoverage(null);
      return;
    }
    let cancelled = false;
    void fetchRegularSoDemandCoverage(effectiveScopedWoId)
      .then((coverage) => {
        if (!cancelled) setRegularSoCoverage(coverage);
      })
      .catch(() => {
        if (!cancelled) setRegularSoCoverage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isRegularFlow, effectiveScopedWoId, liveTick, entries]);

  const handleRegularEndProduction = React.useCallback(
    async (decision: "END_COVERED" | "END_SHORTAGE") => {
      if (!(effectiveScopedWoId > 0)) return;
      let closureReason: string | null = null;
      if (decision === "END_SHORTAGE") {
        closureReason =
          window.prompt(
            `Permanent shortage: ${fmtProdQty(regularSoCoverage?.soShortageQty ?? 0)} will not carry forward.\n\nEnter the closure reason. Choose Continue Later instead if production may resume.`,
          )?.trim() || null;
        if (!closureReason) return;
        if (!window.confirm("I understand this WO will close permanently.")) return;
      }
      setRegularEndProductionBusy(true);
      try {
        const result = await requestRegularEndProduction(effectiveScopedWoId, {
          decision,
          closureReason,
          ...(decision === "END_SHORTAGE" ? { permanentClosureAcknowledged: true as const } : {}),
        });
        setRegularSoCoverage(result.coverage);
        setExecutionPanelRefreshTick((t) => t + 1);
        toast.showSuccess(
          decision === "END_COVERED"
            ? "End Production — complete the mandatory Production Report to close this work order."
            : "End with Shortage — complete the mandatory Production Report, then close with shortfall if needed.",
        );
      } catch (e) {
        toast.showError(e instanceof Error ? e.message : "End production failed");
      } finally {
        setRegularEndProductionBusy(false);
      }
    },
    [effectiveScopedWoId, regularSoCoverage, toast],
  );

  const flowMismatchMessage = React.useMemo(() => {
    if (!resolvedProductionFlow || resolvedProductionFlow === PRODUCTION_FLOW_GREEN_LEVEL) return null;
    const soId =
      flowResolutionSoId > 0
        ? flowResolutionSoId
        : focusSoIdValid
          ? focusSoId
          : 0;
    if (!(soId > 0) || !Object.prototype.hasOwnProperty.call(soOrderTypeById, soId)) return null;
    const v = validateProductionFlowVsOrderType(resolvedProductionFlow, soOrderTypeById[soId]);
    if (!v.ok) {
      console.warn("[production] flow param disagrees with sales order type", {
        flow: resolvedProductionFlow,
        orderType: soOrderTypeById[soId],
      });
      return v.message;
    }
    return null;
  }, [resolvedProductionFlow, flowResolutionSoId, focusSoIdValid, focusSoId, soOrderTypeById]);

  React.useEffect(() => {
    if (flowParam) return;
    if (
      !isProductionWorkspaceEntry({
        fromNoQtySo,
        focusSoIdValid,
        woIdFromUrlValid,
        workOrderLineIdFromUrlValid,
        fromDashboardWithTarget: productionScopedDeepLink,
      })
    ) {
      return;
    }
    const soId = flowResolutionSoId;
    const inferred =
      inferProductionFlowFromLegacy({
        fromNoQtySo,
        orderType: soId > 0 ? soOrderTypeById[soId] : undefined,
      }) ??
      (productionFlowMode === "NO_QTY"
        ? PRODUCTION_FLOW_NO_QTY
        : productionFlowMode === "GREEN_LEVEL"
          ? PRODUCTION_FLOW_GREEN_LEVEL
          : productionFlowMode === "REGULAR"
            ? PRODUCTION_FLOW_REGULAR
            : null);
    if (!inferred) return;
    const next = new URLSearchParams(searchParams);
    if (next.get("flow") === inferred) return;
    next.set("flow", inferred);
    if (inferred === PRODUCTION_FLOW_NO_QTY && !next.get("source")) {
      next.set("source", "no_qty_so");
    }
    const nextSearch = next.toString();
    if (nextSearch === searchParams.toString()) return;
    navigate({ pathname: "/production", search: `?${nextSearch}` }, { replace: true });
  }, [
    flowParam,
    fromNoQtySo,
    focusSoIdValid,
    woIdFromUrlValid,
    workOrderLineIdFromUrlValid,
    noQtyContinueProductionIntent,
    productionScopedDeepLink,
    flowResolutionSoId,
    soOrderTypeById,
    productionFlowMode,
    searchParams,
    navigate,
  ]);

  const navigateNoQtyContext = productionFlowMode === "NO_QTY";
  const navigateGreenLevelContext = productionFlowMode === "GREEN_LEVEL";

  const greenLevelContextWorkOrders = React.useMemo(
    () => filterGreenLevelExecutableWorkOrders(workOrders),
    [workOrders],
  );
  const workOrdersForProductionSelector = navigateGreenLevelContext
    ? greenLevelContextWorkOrders
    : workOrders;

  const showProductionWorkspace = React.useMemo(
    () =>
      isProductionWorkspaceEntry({
        fromNoQtySo,
        focusSoIdValid,
        woIdFromUrlValid,
        workOrderLineIdFromUrlValid,
        fromDashboardWithTarget: productionScopedDeepLink,
      }) &&
      woId === 0 &&
      wolId === 0 &&
      userLockedFlowMode == null,
    [
      fromNoQtySo,
      focusSoIdValid,
      woIdFromUrlValid,
      workOrderLineIdFromUrlValid,
      noQtyContinueProductionIntent,
    productionScopedDeepLink,
      woId,
      wolId,
      userLockedFlowMode,
    ],
  );

  const openProductionFromWorkspace = React.useCallback(
    (row: DashboardProductionStatusSource) => {
      // Terminal-for-production WOs stay out of Active Production; never reopen editable entry.
      const access = resolveProductionWorkspaceRowAccess(row);
      if (!access.allowed) {
        toast.showError(access.reason ?? "This production item cannot be opened.");
        return;
      }
      suppressWorkspaceAutoOpenRef.current = false;
      productionNavGenerationRef.current += 1;
      setSelectedRunAllocationId(null);
      setRunStartEntryGate({
        mode: null,
        loading: false,
        confirmedRunCount: 0,
        entryBlocked: false,
        selectedMachineId: null,
      });
      resetScopedProductionWorkspaceState();
      const href = productionHrefFromProductionWorkspace({
        orderType: row.orderType,
        salesOrderId: row.salesOrderId,
        workOrderId: row.workOrderId,
        workOrderLineId: row.workOrderLineId,
        cycleId: row.cycleId ?? null,
        actionHref: row.actionHref,
      });
      productionNavHistoryRef.current = appendProductionNavHistory(
        productionNavHistoryRef.current,
        href,
      );
      navigate(href, { replace: true });
    },
    [navigate, resetScopedProductionWorkspaceState, toast],
  );

  const noQtyCycleAnchorWoId = React.useMemo(() => {
    if (woId > 0) return woId;
    if (woIdFromUrlValid) return woIdFromUrlPick;
    return 0;
  }, [woId, woIdFromUrlValid, woIdFromUrlPick]);

  const selectedWoForNoQtyProductionCycle = React.useMemo(() => {
    if (!navigateNoQtyContext || noQtyCycleAnchorWoId <= 0) return null;
    return workOrders.find((w) => w.id === noQtyCycleAnchorWoId) ?? null;
  }, [navigateNoQtyContext, noQtyCycleAnchorWoId, workOrders]);

  const woScopedNoQtyCycleId = React.useMemo((): number | null => {
    const wo = selectedWoForNoQtyProductionCycle;
    if (!wo) return null;
    const raw = wo.cycleId ?? wo.cycle?.id ?? null;
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [selectedWoForNoQtyProductionCycle]);

  const noQtyFlowStateCycleQueryId = React.useMemo((): number | null => {
    if (!navigateNoQtyContext) return null;
    return woScopedNoQtyCycleId ?? cycleIdFromUrl ?? null;
  }, [navigateNoQtyContext, woScopedNoQtyCycleId, cycleIdFromUrl]);

  const noQtyFlowSoId = React.useMemo((): number | null => {
    if (focusSoIdValid) return focusSoId;
    if (flowResolutionSoId > 0) return flowResolutionSoId;
    return null;
  }, [focusSoIdValid, focusSoId, flowResolutionSoId]);

  const { state: noQtyFlowState } = useNoQtyFlowState(noQtyFlowSoId, navigateNoQtyContext, {
    cycleId: noQtyFlowStateCycleQueryId,
  });
  const noQtyNextRsReady = noQtyFlowState?.overallWorkflowState === "NEXT_RS_READY";
  const noQtyCarryForwardQtyFromEngine = Number(noQtyFlowState?.productionRemainingQty ?? 0);

  const effectiveNoQtyCycleId = React.useMemo(() => {
    if (!navigateNoQtyContext) return null;
    return woScopedNoQtyCycleId ?? cycleIdFromUrl ?? noQtyFlowState?.cycleId ?? null;
  }, [navigateNoQtyContext, woScopedNoQtyCycleId, cycleIdFromUrl, noQtyFlowState?.cycleId]);

  /** P7E — auto-correct URL when `flow=REGULAR_SO` (or other) disagrees with SO order type. */
  React.useEffect(() => {
    if (!flowMismatchMessage) return;
    const soId =
      flowResolutionSoId > 0
        ? flowResolutionSoId
        : focusSoIdValid
          ? focusSoId
          : 0;
    if (!(soId > 0) || !Object.prototype.hasOwnProperty.call(soOrderTypeById, soId)) return;
    const orderType = soOrderTypeById[soId];
    const targetWoId = woId > 0 ? woId : woIdFromUrlValid ? woIdFromUrlPick : 0;
    const targetWolId =
      wolId > 0 ? wolId : workOrderLineIdFromUrlValid ? workOrderLineIdFromUrl : undefined;
    const woRow = targetWoId > 0 ? workOrders.find((w) => w.id === targetWoId) : null;
    const cycleId =
      orderType === "NO_QTY"
        ? (woRow?.cycleId ?? woRow?.cycle?.id ?? effectiveNoQtyCycleId ?? cycleIdFromUrl ?? null)
        : null;

    const corrected = buildProductionScopedHref({
      workOrderId: targetWoId > 0 ? targetWoId : undefined,
      workOrderLineId: targetWolId,
      salesOrderId: soId,
      orderType,
      cycleId: cycleId ?? undefined,
      from: fromParam || undefined,
    });

    const merged = new URLSearchParams(corrected.includes("?") ? corrected.split("?")[1]?.split("#")[0] ?? "" : "");
    for (const [key, value] of searchParams.entries()) {
      if (key === "flow" || key === "source") continue;
      if (!merged.has(key)) merged.set(key, value);
    }
    const hashIdx = corrected.indexOf("#");
    const hash = hashIdx >= 0 ? corrected.slice(hashIdx) : "";
    const path = hashIdx >= 0 ? corrected.slice(0, hashIdx) : corrected;
    const qIdx = path.indexOf("?");
    const pathname = qIdx >= 0 ? path.slice(0, qIdx) : path;
    const mergedHref = `${pathname}?${merged.toString()}${hash}`;

    const current = `${window.location.pathname}${window.location.search}`;
    if (mergedHref !== current) {
      navigate(mergedHref, { replace: true });
    }
  }, [
    flowMismatchMessage,
    flowResolutionSoId,
    focusSoIdValid,
    focusSoId,
    soOrderTypeById,
    woId,
    woIdFromUrlValid,
    woIdFromUrlPick,
    wolId,
    workOrderLineIdFromUrlValid,
    workOrderLineIdFromUrl,
    effectiveNoQtyCycleId,
    cycleIdFromUrl,
    workOrders,
    fromParam,
    navigate,
  ]);

  /** Deep-linked GL WO without `flow=GREEN_LEVEL` — normalize URL so workbench layout is stable. */
  React.useEffect(() => {
    if (flowParam === PRODUCTION_FLOW_GREEN_LEVEL) return;
    if (!woIdFromUrlValid || workOrders.length === 0) return;
    const wo = workOrders.find((w) => w.id === woIdFromUrlPick);
    if (!wo || !isGreenLevelReplenishmentSourceType(wo.sourceType)) return;
    const params = new URLSearchParams(searchParams);
    params.set("flow", PRODUCTION_FLOW_GREEN_LEVEL);
    const mergedHref = `/production?${params.toString()}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (mergedHref !== current) {
      navigate(mergedHref, { replace: true });
    }
  }, [flowParam, woIdFromUrlValid, woIdFromUrlPick, workOrders, searchParams, navigate]);

  const noQtyCycleNoFromWorkOrders = React.useMemo((): number | null => {
    if (effectiveNoQtyCycleId == null) return null;
    const match = workOrders.find((w) => Number(w.cycleId ?? w.cycle?.id ?? 0) === Number(effectiveNoQtyCycleId));
    const n = match?.cycle?.cycleNo;
    return n != null && Number.isFinite(Number(n)) ? Number(n) : null;
  }, [effectiveNoQtyCycleId, workOrders]);

  const noQtyBannerCycleNo = React.useMemo((): number | null => {
    const n = selectedWoForNoQtyProductionCycle?.cycle?.cycleNo;
    if (n != null && Number.isFinite(Number(n))) return Number(n);
    return null;
  }, [selectedWoForNoQtyProductionCycle]);

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

  const soOrderTypeByIdRef = React.useRef(soOrderTypeById);
  soOrderTypeByIdRef.current = soOrderTypeById;

  const ensureSoOrderType = React.useCallback(async (soId: number): Promise<string> => {
    if (!Number.isFinite(soId) || soId <= 0) return "";
    const cached = soOrderTypeByIdRef.current[soId];
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
  }, []);

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

  const selected = flatLines.find((l) => l.id === wolId);
  producedQtyUnitRef.current = selected?.fgItem?.unit ?? null;

  const fmtProdQty = React.useCallback(
    (n: number, unit?: string | null) => formatFgQuantity(n, unit ?? selected?.fgItem?.unit ?? ""),
    [selected?.fgItem?.unit],
  );

  const fmtProdQtyForInput = React.useCallback(
    (n: number, unit?: string | null) =>
      formatProductionQtyForInput(n, unit ?? selected?.fgItem?.unit ?? null),
    [selected?.fgItem?.unit],
  );

  const operatorProdQtyPlaceholder = productionOperatorQtyPlaceholder(selected?.fgItem?.unit);

  const noQtyCycleNoForDisplay = React.useMemo((): number | null => {
    if (noQtyBannerCycleNo != null) return noQtyBannerCycleNo;
    if (noQtyCycleNoFromWorkOrders != null) return noQtyCycleNoFromWorkOrders;
    if (selected) return cycleNoForWorkOrder(workOrders, selected.workOrderId);
    if (woId > 0) return cycleNoForWorkOrder(workOrders, woId);
    return null;
  }, [noQtyBannerCycleNo, noQtyCycleNoFromWorkOrders, selected, workOrders, woId]);

  const noQtyWorkbenchSoId = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return 0;
    if (focusSoIdValid) return focusSoId;
    if (woIdFromUrlValid) {
      const w = workOrders.find((x) => x.id === woIdFromUrlPick);
      if (w && w.salesOrderId > 0) return w.salesOrderId;
    }
    if (selected && selected.salesOrderId > 0) return selected.salesOrderId;
    if (woId > 0) {
      const w = workOrders.find((x) => x.id === woId);
      if (w && w.salesOrderId > 0) return w.salesOrderId;
    }
    return 0;
  }, [
    productionFlowMode,
    focusSoIdValid,
    focusSoId,
    woIdFromUrlValid,
    woIdFromUrlPick,
    selected,
    woId,
    workOrders,
  ]);

  const showNoQtyScopedProductionCard = productionFlowMode === "NO_QTY" && noQtyWorkbenchSoId > 0;
  const showGreenLevelScopedProductionCard = isGreenLevelFlow;
  const showHardenedScopedProductionCard = showNoQtyScopedProductionCard || showGreenLevelScopedProductionCard;
  const noQtyQcPendingStable = showNoQtyScopedProductionCard && entries.some((e) => qcPendingEntry(e));

  const selectedWoForNoQtyChrome = React.useMemo(() => {
    const id = effectiveScopedWoId > 0 ? effectiveScopedWoId : selected?.workOrderId ?? 0;
    if (!(id > 0)) return null;
    return workOrders.find((w) => w.id === id) ?? null;
  }, [effectiveScopedWoId, selected?.workOrderId, workOrders]);

  const noQtyCarryForwardLines = React.useMemo(() => {
    if (!showNoQtyScopedProductionCard) return [];
    return sortedFlatLines
      .filter((l) => l.salesOrderId === noQtyWorkbenchSoId)
      .filter((l) => isCarryForwardLine(l, "NO_QTY"));
  }, [showNoQtyScopedProductionCard, sortedFlatLines, noQtyWorkbenchSoId, isCarryForwardLine]);

  type NoQtyWorkQueueRow = FlatLine & {
    cycleNo: number | null;
    balance: number;
    queueStatus: "ready" | "qc_pending" | "carry_forward";
    workOrderDocNo?: string | null;
  };

  const noQtyWorkQueueRows = React.useMemo((): NoQtyWorkQueueRow[] => {
    if (!showNoQtyScopedProductionCard) return [];
    const eps = 1e-6;
    let rows = sortedFlatLines.filter((l) => l.salesOrderId === noQtyWorkbenchSoId);
    if (
      effectiveScopedWoId > 0 &&
      (woIdFromUrlValid || noQtyContinueProductionIntent || woId > 0)
    ) {
      rows = rows.filter((l) => l.workOrderId === effectiveScopedWoId);
    }
    return sortFlatByPriority(rows).map((l) => {
      const approved = l.approvedProducedQty ?? 0;
      const qcPending = noQtyQcPendingByWolId.get(l.id) ?? 0;
      const carryForward = approved > eps && qcPending <= eps && noQtyHasApprovedByWolId.has(l.id);
      const queueStatus: NoQtyWorkQueueRow["queueStatus"] =
        qcPending > eps ? "qc_pending" : carryForward ? "carry_forward" : "ready";
      return {
        ...l,
        cycleNo: cycleNoForWorkOrder(workOrders, l.workOrderId),
        balance: lineRemaining(l),
        queueStatus,
        workOrderDocNo: workOrders.find((w) => w.id === l.workOrderId)?.docNo ?? null,
      };
    });
  }, [
    showNoQtyScopedProductionCard,
    sortedFlatLines,
    noQtyWorkbenchSoId,
    effectiveScopedWoId,
    woIdFromUrlValid,
    noQtyContinueProductionIntent,
    woId,
    workOrders,
    noQtyQcPendingByWolId,
    noQtyHasApprovedByWolId,
  ]);

  const noQtyWaitingRequirementRows = React.useMemo(() => {
    if (!showNoQtyScopedProductionCard) return [];
    const eps = 1e-6;
    const activeItemIds = new Set(noQtyWorkQueueRows.map((l) => l.fgItemId));
    const rows: { key: string; itemName: string; cycleNo: number | null }[] = [];
    for (const sh of noQtyShortageHistorySheets) {
      if (
        effectiveNoQtyCycleId != null &&
        sh.cycleId != null &&
        Number(sh.cycleId) !== Number(effectiveNoQtyCycleId)
      ) {
        continue;
      }
      for (const ln of sh.lines) {
        if (ln.finalPlannedQty > eps) continue;
        if (activeItemIds.has(ln.itemId)) continue;
        rows.push({
          key: `${sh.sheetId}-${ln.itemId}`,
          itemName: ln.itemName,
          cycleNo: sh.cycleNo,
        });
      }
    }
    return rows;
  }, [
    showNoQtyScopedProductionCard,
    noQtyWorkQueueRows,
    noQtyShortageHistorySheets,
    effectiveNoQtyCycleId,
  ]);

  /**
   * NO_QTY-only APIs may run only after `soOrderTypeById` confirms the scoped SO is NO_QTY
   * (avoids calling no-qty endpoints while flow mode is transitional or mis-recovered).
   */
  const confirmedNoQtySoId = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return 0;
    const soId = noQtyWorkbenchSoId > 0 ? noQtyWorkbenchSoId : focusSoIdValid ? focusSoId : 0;
    if (!(soId > 0)) return 0;
    if (!Object.prototype.hasOwnProperty.call(soOrderTypeById, soId)) return 0;
    if (String(soOrderTypeById[soId] ?? "") !== "NO_QTY") return 0;
    return soId;
  }, [productionFlowMode, noQtyWorkbenchSoId, focusSoIdValid, focusSoId, soOrderTypeById]);

  const noQtyRequirementSheetsEnabled = confirmedNoQtySoId > 0;

  React.useEffect(() => {
    if (!noQtyRequirementSheetsEnabled) {
      setNoQtyShortageHistorySheets([]);
      setNoQtyShortageHistoryWorkOrders([]);
      setNoQtyShortageHistoryEntriesByCycle({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [list, wos] = await Promise.all([
          apiFetch<NoQtyRsListRow[]>(`/api/sales-orders/${noQtyWorkbenchSoId}/requirement-sheets`),
          apiFetch<WoRow[]>(`/api/production/work-orders?pendingOnly=0&salesOrderId=${noQtyWorkbenchSoId}`),
        ]);
        if (cancelled) return;
        const locked = (list ?? []).filter((s) => String(s.status ?? "") === "LOCKED");
        const sheetDetails = await Promise.all(
          locked.map(async (s) => {
            const detail = await apiFetch<{
              lines?: Array<{
                itemId: number;
                itemName?: string;
                newWoQty?: string;
                requirementQty?: string;
                shortfallQty?: number | null;
                productionRequiredQty?: number | null;
                fulfillmentQty?: number | null;
                totalWoQty?: number | null;
                coveredFromStockQty?: number | null;
              }>;
            }>(`/api/requirement-sheets/${s.id}`);
            const lines: NoQtyRsDisplayLine[] = (detail.lines ?? []).map((ln) => {
              const newRequirement = safeProdNum(ln.newWoQty ?? ln.requirementQty);
              const lastShortageAdded = safeProdNum(ln.shortfallQty);
              const coveredFromStockQty = safeProdNum(ln.coveredFromStockQty);
              const finalPlannedQty = safeProdNum(
                ln.productionRequiredQty ?? ln.totalWoQty ?? ln.fulfillmentQty ?? newRequirement + lastShortageAdded,
              );
              return {
                itemId: ln.itemId,
                itemName: String(ln.itemName ?? `Item #${ln.itemId}`),
                newRequirement,
                lastShortageAdded,
                finalPlannedQty,
                coveredFromStockQty,
              };
            });
            return {
              sheetId: s.id,
              cycleId: s.cycleId,
              cycleNo: s.cycleNo,
              lines,
            };
          }),
        );
        if (cancelled) return;
        setNoQtyShortageHistorySheets(sheetDetails);
        setNoQtyShortageHistoryWorkOrders(wos ?? []);

        const cycleIds = [
          ...new Set(
            sheetDetails
              .map((sh) => (sh.cycleId != null && Number(sh.cycleId) > 0 ? Number(sh.cycleId) : null))
              .filter((id): id is number => id != null),
          ),
        ];
        const entryPairs = await Promise.all(
          cycleIds.map(async (cycleId) => {
            const rows = await apiFetch<ProdEntryRow[]>(
              `/api/production/production-entries?salesOrderId=${noQtyWorkbenchSoId}&cycleId=${cycleId}`,
            );
            return [cycleId, rows ?? []] as const;
          }),
        );
        if (cancelled) return;
        setNoQtyShortageHistoryEntriesByCycle(Object.fromEntries(entryPairs));
      } catch {
        if (!cancelled) {
          setNoQtyShortageHistorySheets([]);
          setNoQtyShortageHistoryWorkOrders([]);
          setNoQtyShortageHistoryEntriesByCycle({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noQtyRequirementSheetsEnabled, noQtyWorkbenchSoId, liveTick]);

  const noQtyProductShortageHistoryRows = React.useMemo((): NoQtyProductShortageHistoryRow[] => {
    if (!showNoQtyScopedProductionCard) return [];
    const itemIds = new Set(noQtyCarryForwardLines.map((l) => l.fgItemId));
    if (itemIds.size === 0) return [];

    const currentCycleId =
      effectiveNoQtyCycleId != null
        ? Number(effectiveNoQtyCycleId)
        : focusSo?.currentCycleId != null
          ? Number(focusSo.currentCycleId)
          : null;

    const rows: NoQtyProductShortageHistoryRow[] = [];
    for (const sheet of noQtyShortageHistorySheets) {
      const cycleId = sheet.cycleId != null && Number(sheet.cycleId) > 0 ? Number(sheet.cycleId) : null;
      const cycleEntries = cycleId != null ? noQtyShortageHistoryEntriesByCycle[cycleId] ?? [] : [];
      const woForSheet = noQtyShortageHistoryWorkOrders.find((w) => Number(w.requirementSheetId) === sheet.sheetId);

      for (const line of sheet.lines) {
        if (!itemIds.has(line.itemId)) continue;
        const woLine = woForSheet?.lines.find((wl) => wl.fgItemId === line.itemId);
        const finalPlannedQty =
          woLine != null && Number.isFinite(Number(woLine.qty))
            ? safeProdNum(woLine.qty)
            : line.finalPlannedQty;
        let producedQty = safeProdNum(woLine?.approvedProducedQty);
        if (producedQty <= 1e-6 && woLine) {
          producedQty = cycleEntries
            .filter((e) => isApproved(e) && Number(e.workOrderLine?.id ?? 0) === woLine.id)
            .reduce((s, e) => s + safeProdNum(e.producedQty), 0);
        } else if (producedQty <= 1e-6) {
          const itemName = line.itemName.trim().toLowerCase();
          producedQty = cycleEntries
            .filter(
              (e) =>
                isApproved(e) &&
                String(e.workOrderLine?.fgItem?.itemName ?? "")
                  .trim()
                  .toLowerCase() === itemName,
            )
            .reduce((s, e) => s + safeProdNum(e.producedQty), 0);
        }
        const shortageQty =
          woLine != null
            ? lineRemaining({
                ...woLine,
                workOrderId: woForSheet?.id ?? 0,
                salesOrderId: focusSoId,
              })
            : Math.max(0, finalPlannedQty - producedQty);

        rows.push({
          key: `${sheet.sheetId}-${line.itemId}`,
          cycleId,
          cycleNo: sheet.cycleNo,
          itemId: line.itemId,
          itemName: line.itemName,
          newRequirement: line.newRequirement,
          lastShortageAdded: line.lastShortageAdded,
          finalPlannedQty,
          producedQty,
          shortageQty,
          isCurrentCycle: currentCycleId != null && cycleId != null && cycleId === currentCycleId,
        });
      }
    }

    return rows.sort((a, b) => {
      const cA = a.cycleNo ?? 0;
      const cB = b.cycleNo ?? 0;
      if (cB !== cA) return cB - cA;
      return a.itemName.localeCompare(b.itemName);
    });
  }, [
    showNoQtyScopedProductionCard,
    noQtyCarryForwardLines,
    noQtyShortageHistorySheets,
    noQtyShortageHistoryWorkOrders,
    noQtyShortageHistoryEntriesByCycle,
    effectiveNoQtyCycleId,
    focusSo?.currentCycleId,
    focusSoId,
  ]);

  const noQtyAutoPickLines = React.useMemo(() => {
    if (!showNoQtyScopedProductionCard) return [];
    if (noQtyNextRsReady) return [];
    if (noQtyQcPendingStable) return [];
    const eps = 1e-6;
    const forSo = flatLines.filter((l) => l.salesOrderId === noQtyWorkbenchSoId);
    const ready = forSo.filter((l) => {
      const rem = lineRemaining(l);
      if (!(rem > eps)) return false;
      const produced = l.approvedProducedQty ?? 0;
      const qcPending = noQtyQcPendingByWolId.get(l.id) ?? 0;
      const carryForward = produced > eps && qcPending <= eps && noQtyHasApprovedByWolId.has(l.id);
      return !carryForward && qcPending <= eps;
    });
    return sortProductionLinesFifo(ready);
  }, [
    flatLines,
    noQtyWorkbenchSoId,
    showNoQtyScopedProductionCard,
    noQtyHasApprovedByWolId,
    noQtyQcPendingByWolId,
    noQtyNextRsReady,
    noQtyQcPendingStable,
  ]);

  const noQtyLineProducibility = React.useMemo((): NoQtyLineProducibility[] => {
    return flatLines.map((l) => {
      const produced = l.approvedProducedQty ?? 0;
      const qcPending = noQtyQcPendingByWolId.get(l.id) ?? 0;
      const carryForward = produced > 1e-6 && qcPending <= 1e-6 && noQtyHasApprovedByWolId.has(l.id);
      return {
        workOrderId: l.workOrderId,
        workOrderLineId: l.id,
        remainingQty: lineRemaining(l),
        qcPendingQty: qcPending,
        isCarryForwardLine: carryForward,
      };
    });
  }, [flatLines, noQtyQcPendingByWolId, noQtyHasApprovedByWolId]);

  /**
   * NO_QTY: hide Add Production Entry when the scoped WO (not the whole SO) has no further entry work.
   * Previously this was SO-scoped — closing WO A left "Production entry completed for this cycle" visible when opening WO B.
   */
  const hideNoQtyAddProductionEntry = React.useMemo(() => {
    const approvedForSo = entries.some(
      (e) =>
        isApproved(e) && Number(e.workOrderLine?.workOrder?.salesOrderId ?? 0) === noQtyWorkbenchSoId,
    );
    const scopedWoRow =
      effectiveScopedWoId > 0 ? workOrders.find((w) => w.id === effectiveScopedWoId) ?? null : null;
    const currentWoHasApprovedProduction =
      effectiveScopedWoId > 0 &&
      entries.some(
        (e) =>
          isApproved(e) && Number(e.workOrderLine?.workOrder?.id ?? 0) === effectiveScopedWoId,
      );
    const currentWoHasProducibleLine = scopedWorkOrderHasProducibleLine(
      noQtyLineProducibility,
      effectiveScopedWoId,
      { allowCarryForwardContinue: noQtyAllowShopFloorContinue },
    );
    const siblingActionableProductionCount = noQtyAutoPickLines.filter(
      (l) => effectiveScopedWoId <= 0 || Number(l.workOrderId) !== Number(effectiveScopedWoId),
    ).length;
    return shouldHideNoQtyAddProductionEntry({
      navigateNoQtyContext,
      showNoQtyScopedProductionCard,
      effectiveScopedWoId,
      noQtyBlockProductionEntry,
      noQtyNextRsReady,
      noQtyAllowShopFloorContinue,
      approvedForSo,
      noQtyAutoPickLinesCount: noQtyAutoPickLines.length,
      currentWoHasProducibleLine,
      currentWoHasApprovedProduction,
      currentWoIsClosed: isScopedWorkOrderClosed(scopedWoRow?.status),
      siblingActionableProductionCount,
    });
  }, [
    navigateNoQtyContext,
    noQtyAllowShopFloorContinue,
    showNoQtyScopedProductionCard,
    effectiveScopedWoId,
    entries,
    noQtyWorkbenchSoId,
    workOrders,
    noQtyLineProducibility,
    noQtyAutoPickLines,
    noQtyNextRsReady,
    noQtyBlockProductionEntry,
    noQtyPendingShortfallDecision,
  ]);

  const hideGreenLevelAddProductionEntry = React.useMemo(() => {
    if (!showGreenLevelScopedProductionCard) return false;
    const scopedWoRow =
      effectiveScopedWoId > 0 ? workOrders.find((w) => w.id === effectiveScopedWoId) ?? null : null;
    const currentWoHasApprovedProduction =
      effectiveScopedWoId > 0 &&
      entries.some(
        (e) =>
          isApproved(e) && Number(e.workOrderLine?.workOrder?.id ?? 0) === effectiveScopedWoId,
      );
    const currentWoHasProducibleLine = scopedWorkOrderHasProducibleLine(
      noQtyLineProducibility,
      effectiveScopedWoId,
    );
    if (currentWoHasProducibleLine) return false;
    if (isScopedWorkOrderClosed(scopedWoRow?.status)) return false;
    if (currentWoHasApprovedProduction) return true;
    return false;
  }, [
    showGreenLevelScopedProductionCard,
    effectiveScopedWoId,
    workOrders,
    entries,
    noQtyLineProducibility,
  ]);

  const forceProductionReportTransition = shouldForceProductionReportTransition({
    transitionWorkOrderId: productionReportTransitionWoId,
    effectiveScopedWoId,
  });

  const hideScopedProductionEntry = hideNoQtyAddProductionEntry || forceProductionReportTransition;

  const greenLevelProductionQueueRows = React.useMemo(
    () =>
      navigateGreenLevelContext
        ? buildGreenLevelProductionQueueRows({ workOrders: greenLevelContextWorkOrders, entries })
        : [],
    [navigateGreenLevelContext, greenLevelContextWorkOrders, entries],
  );

  const selectedGreenLevelQueueRow = React.useMemo((): GreenLevelProductionQueueRow | null => {
    if (!navigateGreenLevelContext || effectiveScopedWolId <= 0) return null;
    return greenLevelProductionQueueRows.find((r) => r.workOrderLineId === effectiveScopedWolId) ?? null;
  }, [navigateGreenLevelContext, effectiveScopedWolId, greenLevelProductionQueueRows]);

  const greenLevelShowQcWaiting = React.useMemo(
    () => navigateGreenLevelContext && greenLevelRowShowsQcWaiting(selectedGreenLevelQueueRow),
    [navigateGreenLevelContext, selectedGreenLevelQueueRow],
  );

  const greenLevelShowProductionEntryForm = React.useMemo(() => {
    if (!navigateGreenLevelContext) return true;
    if (effectiveScopedWolId <= 0) return false;
    if (hideGreenLevelAddProductionEntry) return false;
    return greenLevelRowAllowsProductionEntry(selectedGreenLevelQueueRow);
  }, [
    navigateGreenLevelContext,
    effectiveScopedWolId,
    hideGreenLevelAddProductionEntry,
    selectedGreenLevelQueueRow,
  ]);

  const greenLevelOtherQueueRows = React.useMemo(
    () =>
      greenLevelProductionQueueRows.filter((row) => row.workOrderLineId !== effectiveScopedWolId),
    [greenLevelProductionQueueRows, effectiveScopedWolId],
  );

  const [glWoSwitchPrompt, setGlWoSwitchPrompt] = React.useState<{
    targetRow: GreenLevelProductionQueueRow;
    fromWoLabel: string;
  } | null>(null);

  const pickNoQtyContinueProductionLine = React.useCallback((): FlatLine | null => {
    const eps = 1e-6;
    if (workOrderLineIdFromUrlValid) {
      const byUrl = flatLines.find((l) => l.id === workOrderLineIdFromUrl);
      if (byUrl && lineRemaining(byUrl) > eps) return byUrl;
    }
    if (woIdFromUrlValid) {
      const forWo = sortFlatByPriority(flatLines.filter((l) => l.workOrderId === woIdFromUrlPick));
      const pick = forWo.find((l) => lineRemaining(l) > eps) ?? forWo[0];
      if (pick) return pick;
    }
    const forSo = sortFlatByPriority(
      flatLines.filter((l) => l.salesOrderId === noQtyWorkbenchSoId && lineRemaining(l) > eps),
    );
    if (forSo.length > 0) return forSo[0];
    const cf = sortFlatByPriority(noQtyCarryForwardLines);
    return cf.length > 0 ? cf[0] : null;
  }, [
    flatLines,
    noQtyWorkbenchSoId,
    noQtyCarryForwardLines,
    woIdFromUrlValid,
    woIdFromUrlPick,
    workOrderLineIdFromUrl,
    workOrderLineIdFromUrlValid,
  ]);

  const linesForWo = React.useMemo(() => workOrders.find((w) => w.id === woId)?.lines ?? [], [workOrders, woId]);

  /** Hide carry-forward WO lines from the production entry dropdown unless operator opts in. */
  const linesForNoQtyEntryForm = React.useMemo(() => {
    if (!navigateNoQtyContext || noQtyAllowShopFloorContinue) return linesForWo;
    const soId = workOrders.find((w) => w.id === woId)?.salesOrderId ?? 0;
    return linesForWo.filter((l) => {
      const fl: FlatLine = { ...l, workOrderId: woId, salesOrderId: soId };
      return !isCarryForwardLine(fl, "NO_QTY");
    });
  }, [navigateNoQtyContext, noQtyAllowShopFloorContinue, linesForWo, workOrders, woId, isCarryForwardLine]);

  const applyLine = React.useCallback(
    (l: FlatLine) => {
      const sameSelection =
        woIdRef.current === l.workOrderId && wolIdRef.current === l.id;
      if (woIdRef.current !== l.workOrderId) {
        resetScopedProductionWorkspaceState();
      }
      setWoId((prev) => (prev === l.workOrderId ? prev : l.workOrderId));
      setWolId((prev) => (prev === l.id ? prev : l.id));
      if (sameSelection) return;
      resetProducedQtyField();
      const woRow = workOrders.find((w) => w.id === l.workOrderId);
      const embeddedType = String(
        woRow?.salesOrder?.orderType ?? soOrderTypeById[l.salesOrderId] ?? "",
      ).trim();
      if (embeddedType === "NO_QTY") setUserLockedFlowMode("NO_QTY");
      else if (isGreenLevelReplenishmentSourceType(woRow?.sourceType)) setUserLockedFlowMode("GREEN_LEVEL");
      else if (embeddedType) setUserLockedFlowMode("REGULAR");
      void (async () => {
        const t = await ensureSoOrderType(l.salesOrderId);
        const isGreenLevelWo = isGreenLevelReplenishmentSourceType(woRow?.sourceType);
        // Only refine the synchronous lock above when the async fetch resolved to a
        // concrete order type. An empty `t` (transient API failure / unknown SO) must
        // not silently clobber a correct NO_QTY lock back to REGULAR — that is what
        // hid the Next RS strip when Admin opened Production from the left menu.
        if (t === "NO_QTY") setUserLockedFlowMode("NO_QTY");
        else if (isGreenLevelWo) setUserLockedFlowMode("GREEN_LEVEL");
        else if (t) setUserLockedFlowMode("REGULAR");
        if (isCarryForwardLine(l, t) && !noQtyAllowShopFloorContinue) return;
        // Produced Qty stays blank until the operator types or uses an explicit shortcut.
      })();
    },
    [
      workOrders,
      soOrderTypeById,
      ensureSoOrderType,
      isCarryForwardLine,
      noQtyAllowShopFloorContinue,
      resetProducedQtyField,
      resetScopedProductionWorkspaceState,
    ],
  );

  const onGreenLevelQueueRowAction = React.useCallback(
    (row: GreenLevelProductionQueueRow) => {
      const fl = flatLines.find((l) => l.id === row.workOrderLineId);
      if (fl) {
        applyLine(fl);
        return;
      }
      if (woIdRef.current !== row.workOrderId) {
        resetScopedProductionWorkspaceState();
      }
      setWoId(row.workOrderId);
      setWolId(row.workOrderLineId);
    },
    [flatLines, applyLine, resetScopedProductionWorkspaceState],
  );

  const requestGreenLevelRowSwitch = React.useCallback(
    (row: GreenLevelProductionQueueRow) => {
      const fromWoId = effectiveScopedWoId;
      if (fromWoId > 0 && fromWoId !== row.workOrderId && isProductionReportDraftDirty(fromWoId)) {
        const fromLabel =
          greenLevelProductionQueueRows.find((r) => r.workOrderId === fromWoId)?.woLabel ??
          displayWorkOrderTraceNo(fromWoId);
        setGlWoSwitchPrompt({ targetRow: row, fromWoLabel: fromLabel });
        return;
      }
      onGreenLevelQueueRowAction(row);
    },
    [effectiveScopedWoId, greenLevelProductionQueueRows, onGreenLevelQueueRowAction],
  );

  const navigateToNoQtyProductionLine = React.useCallback(
    (l: FlatLine) => {
      applyLine(l);
      const params = new URLSearchParams();
      params.set("flow", PRODUCTION_FLOW_NO_QTY);
      params.set("workOrderId", String(l.workOrderId));
      params.set("workOrderLineId", String(l.id));
      params.set("source", "no_qty_so");
      if (fromPendingActions) params.set("from", "pending-actions");
      const soId = focusSoIdValid ? focusSoId : l.salesOrderId;
      if (soId > 0) params.set("salesOrderId", String(soId));
      if (effectiveNoQtyCycleId != null && Number(effectiveNoQtyCycleId) > 0) {
        params.set("cycleId", String(effectiveNoQtyCycleId));
      }
      navigate(`/production?${params.toString()}`, { replace: true });
    },
    [applyLine, focusSoIdValid, focusSoId, effectiveNoQtyCycleId, navigate, fromPendingActions],
  );

  const openExecutableProductionLine = React.useCallback(
    (l: FlatLine) => {
      if (suppressWorkspaceAutoOpenRef.current && !urlWoSelectionAuthorityRef.current) {
        return;
      }
      const woRow = workOrders.find((w) => w.id === l.workOrderId);
      const orderType = String(
        woRow?.salesOrder?.orderType ?? soOrderTypeById[l.salesOrderId] ?? "",
      ).trim();
      if (orderType === "NO_QTY" || navigateNoQtyContext) {
        navigateToNoQtyProductionLine(l);
        return;
      }
      const target = {
        workOrderId: l.workOrderId,
        workOrderLineId: l.id,
        flow: PRODUCTION_FLOW_REGULAR,
      };
      if (productionScopedUrlAlreadyMatches(searchParams, target)) {
        applyLine(l);
        return;
      }
      const nextSearch = buildRegularExecutableProductionSearch({
        ...target,
        salesOrderId: focusSoIdValid ? focusSoId : l.salesOrderId > 0 ? l.salesOrderId : undefined,
        from: fromParam || undefined,
        returnTo: searchParams.get("returnTo"),
      });
      const href = `/production?${nextSearch}`;
      if (detectProductionNavOscillation(productionNavHistoryRef.current, href)) {
        suppressWorkspaceAutoOpenRef.current = true;
        return;
      }
      // Claim URL authority before state mutation so overview clear cannot fight mid-navigate.
      urlWoSelectionAuthorityRef.current = true;
      urlSelectionAppliedRef.current = true;
      suppressWorkspaceAutoOpenRef.current = false;
      applyLine(l);
      productionNavHistoryRef.current = appendProductionNavHistory(
        productionNavHistoryRef.current,
        href,
      );
      navigate(href, { replace: true });
    },
    [
      workOrders,
      soOrderTypeById,
      navigateNoQtyContext,
      navigateToNoQtyProductionLine,
      applyLine,
      searchParams,
      navigate,
      focusSoIdValid,
      focusSoId,
      fromParam,
    ],
  );

  const returnToProductionWorkspaceDashboard = React.useCallback(
    (opts?: { refreshAfter?: boolean }) => {
      if (productionCloseReturnTimerRef.current != null) {
        window.clearTimeout(productionCloseReturnTimerRef.current);
        productionCloseReturnTimerRef.current = null;
      }
      suppressWorkspaceAutoOpenRef.current = true;
      productionNavGenerationRef.current += 1;
      setSelectedRunAllocationId(null);
      setRunStartEntryGate({
        mode: null,
        loading: false,
        confirmedRunCount: 0,
        entryBlocked: false,
        selectedMachineId: null,
      });
      clearWoLineSelection({ force: true });
      urlSelectionAppliedRef.current = false;
      urlWoSelectionAuthorityRef.current = false;
      setUserLockedFlowMode(null);
      resetScopedProductionWorkspaceState();
      const href = buildPostProductionReportCloseHref({
        from: searchParams.get("from"),
        returnTo: searchParams.get("returnTo"),
        source: searchParams.get("source"),
      });
      if (detectProductionNavOscillation(productionNavHistoryRef.current, href)) {
        // Stay on clean overview — do not bounce.
        navigate(
          buildProductionWorkspaceListHref({
            productionBucket: "readyToStart",
            from:
              String(searchParams.get("from") ?? "").trim() === "pending-actions"
                ? "pending-actions"
                : null,
          }),
          { replace: true },
        );
      } else {
        productionNavHistoryRef.current = appendProductionNavHistory(
          productionNavHistoryRef.current,
          href,
        );
        navigate(href, { replace: true });
      }
      if (opts?.refreshAfter) {
        bumpErpRefresh([...PRODUCTION_REPORT_CONFIRM_REFRESH_SCOPES]);
        void refresh().then(() => {
          setExecutionPanelRefreshTick((t) => t + 1);
        });
      }
    },
    [clearWoLineSelection, navigate, resetScopedProductionWorkspaceState, refresh, searchParams],
  );

  const navigateBackToProductionWorkspaceList = React.useCallback(
    (targetHref?: string) => {
      if (backToWorkspaceBusyRef.current) return;
      backToWorkspaceBusyRef.current = true;
      setBackToWorkspaceBusy(true);
      suppressWorkspaceAutoOpenRef.current = true;
      productionNavGenerationRef.current += 1;
      setSelectedRunAllocationId(null);
      setRunStartEntryGate({
        mode: null,
        loading: false,
        confirmedRunCount: 0,
        entryBlocked: false,
        selectedMachineId: null,
      });
      clearWoLineSelection({ force: true });
      urlSelectionAppliedRef.current = false;
      urlWoSelectionAuthorityRef.current = false;
      setUserLockedFlowMode(null);
      resetScopedProductionWorkspaceState();
      const scopedWoId =
        woIdRef.current > 0
          ? woIdRef.current
          : woIdFromUrlValid
            ? woIdFromUrlPick
            : 0;
      const fallback = resolveProductionRegularBack({
        fromParam: fromParam || "production-workspace",
        sourceParam: source,
        fromStepParam,
        returnToParam: searchParams.get("returnTo") ?? "",
        salesOrderId: focusSoIdValid ? focusSoId : 0,
        workOrderId: scopedWoId,
        productionBucket: productionBucketFilter,
        hasActiveDraft: false,
      });
      const href = String(targetHref ?? fallback.to).trim() || fallback.to;
      if (!detectProductionNavOscillation(productionNavHistoryRef.current, href)) {
        productionNavHistoryRef.current = appendProductionNavHistory(
          productionNavHistoryRef.current,
          href,
        );
      }
      navigate(href, { replace: true });
      window.setTimeout(() => {
        backToWorkspaceBusyRef.current = false;
        setBackToWorkspaceBusy(false);
      }, 450);
    },
    [
      clearWoLineSelection,
      resetScopedProductionWorkspaceState,
      fromParam,
      source,
      fromStepParam,
      searchParams,
      focusSoIdValid,
      focusSoId,
      woIdFromUrlValid,
      woIdFromUrlPick,
      productionBucketFilter,
      navigate,
    ],
  );

  const handleProductionExecutionClosed = React.useCallback(
    async (payload: { workOrderId: number; outcome: ProductionExecutionClosedOutcome }) => {
      // Navigate to Ready to Start before refresh so mid-refresh never paints legacy NO_QTY chrome.
      toast.showSuccess(buildProductionCloseSuccessToast(payload.outcome));
      returnToProductionWorkspaceDashboard({ refreshAfter: true });
    },
    [toast, returnToProductionWorkspaceDashboard],
  );

  const handleProductionReportConfirmed = React.useCallback(
    async (meta: {
      requiresShortfallDecision: boolean;
      remainderQty: number;
      executionCloseOutcome?: string | null;
    }) => {
      const confirmedWoId = effectiveScopedWoId;
      if (confirmedWoId <= 0) return;

      const confirmedWoRow = workOrders.find((w) => w.id === confirmedWoId);
      const woLabel = displayWorkOrderNo(confirmedWoId, confirmedWoRow?.docNo ?? null);
      const closedByConfirm = Boolean(meta.executionCloseOutcome);

      // WO closed via Confirm Report & Close WO — never auto-open another WO or keep NO_QTY runner.
      if (closedByConfirm) {
        toast.showSuccess(buildProductionCloseSuccessToast(
          String(meta.executionCloseOutcome).toUpperCase() === "CARRY_FORWARD"
            ? "CARRY_FORWARD"
            : String(meta.executionCloseOutcome).toUpperCase() === "SURPLUS"
              ? "SURPLUS"
              : "COMPLETE",
        ));
        returnToProductionWorkspaceDashboard({ refreshAfter: true });
        return;
      }

      bumpErpRefresh([...PRODUCTION_REPORT_CONFIRM_REFRESH_SCOPES]);

      const { flatLines: nextFlat, entries: nextEntries } = await refresh();
      setExecutionPanelRefreshTick((t) => t + 1);
      setCompletionEvaluateTick(0);
      setCompletionEvaluateBatchQty(0);

      const qcPendingByWolId = buildQcPendingByWorkOrderLineId(nextEntries);
      const queueLines = buildProductionQueueLines(nextFlat, qcPendingByWolId);

      const advance = resolvePostProductionReportConfirmAdvance({
        confirmedWorkOrderId: confirmedWoId,
        lines: queueLines,
        requiresShortfallDecision: navigateGreenLevelContext
          ? false
          : meta.requiresShortfallDecision,
        forceAdvanceFromConfirmedWorkOrder: false,
      });

      if (advance.kind === "workspace") {
        toast.showSuccess(`Production report confirmed for ${woLabel}.`);
        returnToProductionWorkspaceDashboard({ refreshAfter: true });
        return;
      }

      if (advance.kind === "stay") {
        toast.showSuccess(`Production report confirmed for ${woLabel}.`);
        urlSelectionAppliedRef.current = false;
        if (advance.line) {
          const fullLine = nextFlat.find((l) => l.id === advance.line!.id);
          if (fullLine) {
            openExecutableProductionLine(fullLine);
            return;
          }
        }
        return;
      }

      // Non-close advance with another executable WO (rare) — still prefer card workspace over legacy NO_QTY.
      toast.showSuccess(`Production report confirmed for ${woLabel}.`);
      returnToProductionWorkspaceDashboard({ refreshAfter: true });
    },
    [
      effectiveScopedWoId,
      workOrders,
      refresh,
      toast,
      returnToProductionWorkspaceDashboard,
      navigateGreenLevelContext,
      openExecutableProductionLine,
    ],
  );

  const executableProductionQueueLines = React.useMemo(
    () =>
      buildProductionQueueLines(flatLines, noQtyQcPendingByWolId),
    [flatLines, noQtyQcPendingByWolId],
  );

  const hasPendingProductionWork = React.useMemo(
    () => hasExecutableProductionWork(executableProductionQueueLines),
    [executableProductionQueueLines],
  );

  /** Deep-link: apply WO/line from URL — authoritative; never fight auto-pick heuristics. */
  React.useEffect(() => {
    if (!canProd || workOrders.length === 0 || flatLines.length === 0) return;
    if (!urlWoSelectionAuthority) return;

    if (workOrderLineIdFromUrlValid) {
      const byUrl = flatLines.find((l) => l.id === workOrderLineIdFromUrl);
      if (!byUrl) return;
      if (woIdRef.current === byUrl.workOrderId && wolIdRef.current === byUrl.id) {
        urlSelectionAppliedRef.current = true;
        return;
      }
      applyLine(byUrl);
      urlSelectionAppliedRef.current = true;
      return;
    }

    if (!woIdFromUrlValid) return;

    const woExists = workOrders.some((w) => w.id === woIdFromUrlPick);
    if (!woExists) return;

    const forWo = sortFlatByPriority(flatLines.filter((l) => l.workOrderId === woIdFromUrlPick));
    if (forWo.length === 0) {
      if (woIdRef.current !== woIdFromUrlPick) setWoId(woIdFromUrlPick);
      return;
    }
    const eps = 1e-6;
    const pick = forWo.find((l) => lineRemaining(l) > eps) ?? forWo[0];
    if (woIdRef.current === pick.workOrderId && wolIdRef.current === pick.id) {
      urlSelectionAppliedRef.current = true;
      return;
    }
    applyLine(pick);
    urlSelectionAppliedRef.current = true;
  }, [
    canProd,
    workOrders,
    flatLines,
    urlWoSelectionAuthority,
    woIdFromUrlValid,
    woIdFromUrlPick,
    workOrderLineIdFromUrlValid,
    workOrderLineIdFromUrl,
    applyLine,
  ]);

  useDependentFieldFocus({
    targetRef: producedQtyRef,
    enabled: Boolean(canProd && flatLines.length > 0 && wolId > 0),
    deps: [wolId],
  });

  const [rmReadiness, setRmReadiness] = React.useState<ProductionRmReadiness | null>(null);
  const [rmReadinessLoading, setRmReadinessLoading] = React.useState(false);
  const [seededRmReadiness, setSeededRmReadiness] = React.useState<ProductionRmReadiness | null>(null);
  const [rmReadinessRefreshTick] = React.useState(0);
  const isNoQtyProductionFlow =
    fromNoQtySo || productionFlowMode === "NO_QTY" || navigateNoQtyContext;
  const showRegularRmReadiness = wolId > 0 && isRegularFlow;
  const showNoQtyRmStatus = wolId > 0 && isNoQtyFlow;
  const selectedQueueRow = React.useMemo(
    () => (wolId > 0 ? productionQueueByLineId.get(wolId) ?? null : null),
    [productionQueueByLineId, wolId],
  );
  const queueSeededRmReadiness = React.useMemo(() => {
    if (!selectedQueueRow || !isQueueRmReadinessSufficient(selectedQueueRow)) return null;
    return buildReadinessSeedFromQueueRow(selectedQueueRow);
  }, [selectedQueueRow]);
  const effectiveRmReadiness = rmReadiness ?? queueSeededRmReadiness;
  const rmProductionEntryBlocked =
    (showRegularRmReadiness || showNoQtyRmStatus) &&
    isRegularProductionEntryBlocked(
      effectiveRmReadiness,
      rmReadinessLoading && !queueSeededRmReadiness,
    );

  const selectedWoForLifecycle = React.useMemo(() => {
    const id = woId > 0 ? woId : selected?.workOrderId ?? 0;
    if (!(id > 0)) return null;
    return workOrders.find((w) => w.id === id) ?? null;
  }, [woId, selected?.workOrderId, workOrders]);

  const woProductionLifecycleBlocked =
    selectedWoForLifecycle != null && isWorkOrderProductionBlocked(selectedWoForLifecycle.status);
  const woProductionLifecycleMessage = selectedWoForLifecycle
    ? workOrderProductionBlockedMessage(selectedWoForLifecycle)
    : null;
  const selectedWoPaused = isWorkOrderPausedStatus(selectedWoForLifecycle?.status);
  const [resumeWoBusy, setResumeWoBusy] = React.useState(false);

  /** Active DRAFT on the selected WO line — REGULAR create form must not add a second batch. */
  const latestDraftForSelectedWoLine = React.useMemo(() => {
    if (!selected || !canProd || isNoQtyProductionFlow || navigateGreenLevelContext) return null;
    const lineId = selected.id;
    const draftsForLine = entries.filter(
      (e) => isDraft(e) && Number(e.workOrderLine?.id ?? 0) === lineId,
    );
    if (!draftsForLine.length) return null;
    const latest = draftsForLine
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const qty = Number(latest?.producedQty ?? 0);
    const producedQty = Number.isFinite(qty) ? qty : 0;
    return { latest, producedQty };
  }, [selected, canProd, entries, isNoQtyProductionFlow]);

  const regularCreateFormLockedByDraft = Boolean(latestDraftForSelectedWoLine);

  const productionShiftLinkHint = React.useMemo(() => {
    const fromEntry =
      latestDraftForSelectedWoLine?.latest?.shiftLink ??
      (wolId > 0
        ? entries.find((e) => Number(e.workOrderLine?.id ?? 0) === wolId)?.shiftLink
        : null) ??
      lastCreatedShiftLink ??
      null;
    if (!fromEntry) {
      // After load with no PE yet — do not imply a failed match until create/load has a row.
      return null;
    }
    if (fromEntry.linked && fromEntry.shiftSessionNo) {
      return `Linked to Shift ${fromEntry.shiftSessionNo}`;
    }
    return "No active matching shift";
  }, [latestDraftForSelectedWoLine, wolId, entries, lastCreatedShiftLink]);

  React.useEffect(() => {
    setLastCreatedShiftLink(null);
  }, [wolId]);

  const [shiftProductionQtyLocked, setShiftProductionQtyLocked] = React.useState(false);
  const [shiftProductionQtyLockReason, setShiftProductionQtyLockReason] = React.useState<string | null>(
    null,
  );
  const [linkedShiftOverdue, setLinkedShiftOverdue] = React.useState(false);
  const [linkedShiftOverdueMessage, setLinkedShiftOverdueMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const sessionIdFromEntry =
      (Number.isFinite(shiftSessionIdFromUrl) && shiftSessionIdFromUrl > 0
        ? shiftSessionIdFromUrl
        : null) ??
      latestDraftForSelectedWoLine?.latest?.shiftLink?.shiftSessionId ??
      (wolId > 0
        ? entries.find((e) => Number(e.workOrderLine?.id ?? 0) === wolId)?.shiftLink?.shiftSessionId
        : null) ??
      lastCreatedShiftLink?.shiftSessionId ??
      null;
    const machineId = runStartEntryGate.selectedMachineId ?? null;

    function applySessionOverdue(session: {
      status?: string | null;
      sessionDate?: string | Date | null;
      shift?: { startTime?: string | null; endTime?: string | null } | null;
      shiftOverdue?: boolean;
      shiftOverdueMessage?: string | null;
    } | null) {
      if (!session) {
        setLinkedShiftOverdue(false);
        setLinkedShiftOverdueMessage(null);
        return;
      }
      const live = evaluateOpenShiftOverdue({
        status: session.status,
        sessionDate: session.sessionDate,
        startTime: session.shift?.startTime,
        endTime: session.shift?.endTime,
      });
      const overdue = Boolean(session.shiftOverdue) || live.overdue;
      setLinkedShiftOverdue(overdue);
      setLinkedShiftOverdueMessage(
        overdue ? live.message || session.shiftOverdueMessage || SHIFT_OVERDUE_MESSAGE : null,
      );
    }

    async function loadLock() {
      try {
        if (sessionIdFromEntry != null && Number(sessionIdFromEntry) > 0) {
          const res = await fetchShiftSession(Number(sessionIdFromEntry));
          if (cancelled) return;
          setShiftProductionQtyLocked(Boolean(res.session?.productionQtyLocked));
          setShiftProductionQtyLockReason(res.session?.productionQtyLockReason ?? null);
          applySessionOverdue(res.session);
          return;
        }
        if (machineId != null && machineId > 0) {
          const res = await fetchOpenShiftSession(machineId);
          if (cancelled) return;
          const sess = res.session;
          setShiftProductionQtyLocked(Boolean(sess?.productionQtyLocked));
          setShiftProductionQtyLockReason(sess?.productionQtyLockReason ?? null);
          applySessionOverdue(sess);
          return;
        }
        if (!cancelled) {
          setShiftProductionQtyLocked(false);
          setShiftProductionQtyLockReason(null);
          applySessionOverdue(null);
        }
      } catch {
        if (!cancelled) {
          setShiftProductionQtyLocked(false);
          setShiftProductionQtyLockReason(null);
          applySessionOverdue(null);
        }
      }
    }

    void loadLock();
    return () => {
      cancelled = true;
    };
  }, [
    latestDraftForSelectedWoLine,
    wolId,
    entries,
    lastCreatedShiftLink,
    runStartEntryGate.selectedMachineId,
    shiftSessionIdFromUrl,
    liveTick,
  ]);

  const shiftQtyLockMessage =
    shiftProductionQtyLockReason ||
    (shiftProductionQtyLocked ? SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE : null);

  const selectedMetrics = React.useMemo(() => {
    if (!selected) return null;
    const approved = selected.approvedProducedQty ?? 0;
    // Production planning is scoped to the selected WO line, not the SO item total.
    const woLineQty = Number(selected.qty);
    const remaining = lineRemaining(selected);
    return {
      woLineQty: Number.isFinite(woLineQty) ? woLineQty : 0,
      usedQty: approved,
      remainingQty: remaining,
    };
  }, [selected]);

  const productionEntryCapacityPhase = React.useMemo(() => {
    if (!(showRegularRmReadiness || showNoQtyRmStatus)) return null;
    if (!effectiveRmReadiness && !selectedMetrics) return null;
    return resolveProductionEntryCapacityPhase({
      gate: effectiveRmReadiness?.gate,
      bomMissing: effectiveRmReadiness?.bomMissing,
      productionAllowedNowQty: effectiveRmReadiness?.productionAllowedNowQty,
      maxAdditionalQty: effectiveRmReadiness?.maxAdditionalQty,
      woQty: effectiveRmReadiness?.woQty ?? selectedMetrics?.woLineQty,
      woRemainingQty: effectiveRmReadiness?.woRemainingQty ?? selectedMetrics?.remainingQty,
      approvedProducedQty: effectiveRmReadiness?.approvedProducedQty ?? selectedMetrics?.usedQty,
      rmSupportedCumulativeCapacityQty: effectiveRmReadiness?.rmSupportedCumulativeCapacityQty,
    });
  }, [showRegularRmReadiness, showNoQtyRmStatus, effectiveRmReadiness, selectedMetrics]);

  const productionQuantityCompleted = productionEntryCapacityPhase === "QUANTITY_COMPLETED";
  const productionWaitingRmForCapacity = productionEntryCapacityPhase === "WAITING_RM";

  const pausedWoQtyStrip = React.useMemo(() => {
    if (!selected || !selectedWoPaused || !selectedMetrics) return null;
    const lineEntries = entries.filter(
      (e) => Number(e.workOrderLine?.id ?? 0) === Number(selected.id) && isApproved(e),
    );
    const qcAcceptedQty = lineEntries.reduce((s, e) => s + Math.max(0, Number(e.qcAcceptedQty ?? 0)), 0);
    return {
      plannedQty: selectedMetrics.woLineQty,
      producedQty: selectedMetrics.usedQty,
      qcAcceptedQty,
      remainingProductionQty: selectedMetrics.remainingQty,
    };
  }, [selected, selectedWoPaused, selectedMetrics, entries]);

  const [pausedFgBalance, setPausedFgBalance] = React.useState<{ dispatchedQty: number; reservedFgQty: number } | null>(
    null,
  );
  React.useEffect(() => {
    if (!selectedWoPaused || !focusSoIdValid || !selected) {
      setPausedFgBalance(null);
      return;
    }
    let cancelled = false;
    void apiFetch<{ items?: Array<{ itemId: number; qcApprovedRemaining?: number; dispatchedQty?: number }> }>(
      `/api/production/sales-orders/${focusSoId}/fg-work-order-balance`,
    )
      .then((payload) => {
        if (cancelled) return;
        const row = (payload.items ?? []).find((x) => Number(x.itemId) === Number(selected.fgItemId));
        const reservedFgQty = Math.max(0, Number(row?.qcApprovedRemaining ?? 0));
        const dispatchedQty = Math.max(0, Number(row?.dispatchedQty ?? 0));
        setPausedFgBalance({ dispatchedQty, reservedFgQty });
      })
      .catch(() => {
        if (!cancelled) setPausedFgBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWoPaused, focusSoIdValid, focusSoId, selected?.fgItemId, selected?.id]);

  /** Matches RM readiness strip headline ("Production allowed now"). */
  const rmAllowedNowQty = React.useMemo(() => {
    if (!showRegularRmReadiness && !showNoQtyRmStatus) return null;
    return resolveRegularRmAllowedNowQty(effectiveRmReadiness);
  }, [showRegularRmReadiness, showNoQtyRmStatus, effectiveRmReadiness]);

  /** Max qty for save/approve/clamp — same readiness payload, WO balance from API when present. */
  const rmEntryQtyCap = React.useMemo(() => {
    if ((!showRegularRmReadiness && !showNoQtyRmStatus) || !selectedMetrics) return null;
    return resolveRegularRmEntryQtyCap(effectiveRmReadiness, {
      lineWoRemaining: selectedMetrics.remainingQty,
      excludeProductionQty: editing?.workOrderLine?.id === wolId ? Number(editing.producedQty) : undefined,
    });
  }, [showRegularRmReadiness, showNoQtyRmStatus, effectiveRmReadiness, selectedMetrics, editing, wolId]);

  const producedQtyWithinCaps = React.useMemo(() => {
    if (!producedQtyValid || producedQtyParsed == null) return false;
    // REGULAR Target Remaining is not an entry hard stop when RM readiness governs capacity.
    if (
      !fromNoQtySo &&
      !showRegularRmReadiness &&
      selectedMetrics &&
      producedQtyParsed > selectedMetrics.remainingQty + 1e-6
    ) {
      return false;
    }
    if (
      (showRegularRmReadiness || showNoQtyRmStatus) &&
      rmEntryQtyCap != null &&
      !rmReadinessLoading &&
      producedQtyParsed > rmEntryQtyCap + 1e-6
    ) {
      return false;
    }
    return true;
  }, [
    producedQtyValid,
    producedQtyParsed,
    selectedMetrics,
    fromNoQtySo,
    showRegularRmReadiness,
    showNoQtyRmStatus,
    rmEntryQtyCap,
    rmReadinessLoading,
  ]);

  const createFormCanSubmit = Boolean(
    !flowMismatchMessage &&
      wolId > 0 &&
      flatLines.some((l) => l.id === wolId) &&
      producedQtyValid &&
      producedQtyWithinCaps &&
      !rmProductionEntryBlocked &&
      !productionQuantityCompleted &&
      !woProductionLifecycleBlocked &&
      !regularCreateFormLockedByDraft &&
      !shiftProductionQtyLocked &&
      !shouldHideRegularProductionEntryForReport(regularSoCoverage) &&
      !(navigateNoQtyContext && noQtyBlockProductionEntry) &&
      !runStartEntryBlocked &&
      (runStartEntryGate.mode !== "MACHINE_RUN_PLANNING" ||
        (selectedRunAllocationId != null && selectedRunAllocationId > 0)),
  );

  const onRmReadinessLoaded = React.useCallback((data: ProductionRmReadiness | null) => {
    if (data && Number(data.workOrderLineId ?? 0) !== wolIdRef.current) return;
    setRmReadiness(data);
    if (data && seededRmReadiness?.workOrderLineId === data.workOrderLineId) {
      setSeededRmReadiness(null);
    }
  }, [seededRmReadiness]);

  const onRmReadinessLoadingChange = React.useCallback((loading: boolean) => {
    setRmReadinessLoading(loading);
  }, []);

  const conciseRmLabel = React.useMemo(() => {
    if (rmReadiness) return deriveProductionConciseRmLabel(rmReadiness);
    return deriveConciseRmLabelFromQueueRow(selectedQueueRow);
  }, [rmReadiness, selectedQueueRow]);

  const conciseRmInitialData = React.useMemo(() => {
    if (seededRmReadiness?.workOrderLineId === wolId) return seededRmReadiness;
    if (queueSeededRmReadiness?.workOrderLineId === wolId) return queueSeededRmReadiness;
    return null;
  }, [seededRmReadiness, queueSeededRmReadiness, wolId]);

  React.useEffect(() => {
    if (!showRegularRmReadiness && !showNoQtyRmStatus) {
      setRmReadiness(null);
      setRmReadinessLoading(false);
      setSeededRmReadiness(null);
      return;
    }
    if (seededRmReadiness?.workOrderLineId === wolId) {
      setRmReadiness(seededRmReadiness);
      setRmReadinessLoading(false);
      return;
    }
    if (queueSeededRmReadiness?.workOrderLineId === wolId) {
      setRmReadiness(queueSeededRmReadiness);
      setRmReadinessLoading(false);
      return;
    }
    setRmReadiness(null);
    setRmReadinessLoading(true);
  }, [showRegularRmReadiness, showNoQtyRmStatus, wolId, seededRmReadiness, queueSeededRmReadiness]);

  const showRegularProductionEntry =
    !flowMismatchMessage &&
    showRegularRmReadiness &&
    !rmProductionEntryBlocked &&
    !productionQuantityCompleted &&
    !rmReadinessLoading &&
    !shouldHideRegularProductionEntryForReport(regularSoCoverage);

  React.useEffect(() => {
    if (!regularCreateFormLockedByDraft) return;
    if (producedQtyStr.trim()) resetProducedQtyField();
  }, [regularCreateFormLockedByDraft, producedQtyStr, resetProducedQtyField]);

  const noQtyEntryContextLine = React.useMemo(() => {
    if (!selected || !selectedMetrics) return "";
    const woRow = workOrders.find((w) => w.id === selected.workOrderId);
    return formatNoQtyProductionEntryContextLine({
      cycleNo: noQtyCycleNoForDisplay,
      workOrderId: selected.workOrderId,
      woDocNo: woRow?.docNo ?? null,
      requirementSheetId: woRow?.requirementSheetId ?? null,
      itemName: selected.fgItem.itemName,
      remainingQty: selectedMetrics.remainingQty,
    });
  }, [selected, selectedMetrics, workOrders, noQtyCycleNoForDisplay]);

  /** SO rolling-cycle pointer advanced — WO is an allowed optional carry-forward production surface. */
  const showNoQtyOptionalPriorCycleStrip = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY" || focusSo?.currentCycleId == null) return false;
    const woRow = workOrders.find((w) => w.id === woId);
    if (!woRow) return false;
    const rawC = woRow.cycleId ?? (woRow as { cycle?: { id?: number } }).cycle?.id ?? null;
    const woCid = rawC != null ? Number(rawC) : NaN;
    if (!Number.isFinite(woCid) || woCid <= 0) return false;
    const ptr = Number(focusSo.currentCycleId);
    if (!Number.isFinite(ptr) || ptr <= 0) return false;
    return woCid !== ptr;
  }, [navigateNoQtyContext, focusSo?.currentCycleId, workOrders, woId]);

  React.useEffect(() => {
    let cancelled = false;
    void apiFetch<DashboardProductionStatusSource[]>("/api/dashboard/production-queue")
      .then((data) => {
        if (!cancelled) setNoQtyProductionQueue(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setNoQtyProductionQueue([]);
      });
    return () => {
      cancelled = true;
    };
  }, [liveTick]);

  const noQtyViewingPriorCycle = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return false;
    if (showNoQtyOptionalPriorCycleStrip) return true;
    const ptr =
      focusSo?.currentCycleId ?? noQtyFlowState?.canonicalCycleId ?? noQtyFlowState?.cycleId ?? null;
    const viewed = effectiveNoQtyCycleId;
    return (
      ptr != null &&
      viewed != null &&
      Number(viewed) > 0 &&
      Number(viewed) !== Number(ptr)
    );
  }, [
    productionFlowMode,
    showNoQtyOptionalPriorCycleStrip,
    focusSo?.currentCycleId,
    noQtyFlowState?.canonicalCycleId,
    noQtyFlowState?.cycleId,
    effectiveNoQtyCycleId,
  ]);

  const noQtyCycleDisplayStatus = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return null;
    const woIdForStatus = woId > 0 ? woId : selected?.workOrderId ?? 0;
    if (!(woIdForStatus > 0)) return null;
    const woRow =
      workOrders.find((w) => w.id === woIdForStatus) ??
      noQtyShortageHistoryWorkOrders.find((w) => w.id === woIdForStatus);
    if (woRow) {
      return resolveNoQtyCycleDisplayStatusForWorkOrder(
        {
          id: woRow.id,
          status: woRow.status ?? "IN_PROGRESS",
          salesOrderId: woRow.salesOrderId,
          cycleId: woRow.cycleId ?? woRow.cycle?.id ?? null,
          cycle: woRow.cycle,
          lines: woRow.lines,
        },
        noQtyProductionQueue,
        {
          isPriorCycle: noQtyViewingPriorCycle,
          scope: noQtyViewingPriorCycle ? "historical" : "auto",
        },
      );
    }
    if (!selected || !selectedMetrics) return null;
    return resolveNoQtyCycleDisplayStatus({
      workOrderId: woIdForStatus,
      workOrderNo: displayWorkOrderTraceNo(woIdForStatus),
      itemName: selected.fgItem.itemName,
      requiredQty: selectedMetrics.woLineQty,
      producedQty: selectedMetrics.usedQty,
      balanceQty: selectedMetrics.remainingQty,
      orderType: "NO_QTY",
      salesOrderId: selected.salesOrderId,
      cycleId: effectiveNoQtyCycleId,
      cycleNo: noQtyCycleNoForDisplay,
      allQueueRows: noQtyProductionQueue,
      isPriorCycle: noQtyViewingPriorCycle,
      scope: noQtyViewingPriorCycle ? "historical" : "auto",
    });
  }, [
    productionFlowMode,
    woId,
    selected,
    selectedMetrics,
    workOrders,
    noQtyShortageHistoryWorkOrders,
    noQtyProductionQueue,
    noQtyViewingPriorCycle,
    effectiveNoQtyCycleId,
    noQtyCycleNoForDisplay,
  ]);

  const noQtyDisplayOperatorPendingQty = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return null;
    if (selectedMetrics) {
      const planned = Number(selectedMetrics.woLineQty ?? 0);
      const produced = Number(selectedMetrics.usedQty ?? 0);
      const pending = Math.max(0, planned - produced);
      if (pending > 1e-6) return pending;
    }
    const woIdFor = woId > 0 ? woId : selected?.workOrderId ?? 0;
    if (!(woIdFor > 0)) return null;
    const fromQueue = noQtyOperatorPendingQtyForWorkOrder(woIdFor, noQtyProductionQueue);
    return fromQueue > 1e-6 ? fromQueue : null;
  }, [productionFlowMode, woId, selected?.workOrderId, selectedMetrics, noQtyProductionQueue]);

  const noQtyErpAdjustedPlanningQty = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return null;
    const woIdFor = woId > 0 ? woId : selected?.workOrderId ?? 0;
    if (!(woIdFor > 0)) return null;
    const fromQueue = noQtyErpAdjustedPlanningQtyForWorkOrder(woIdFor, noQtyProductionQueue);
    return fromQueue > 1e-6 ? fromQueue : null;
  }, [productionFlowMode, woId, selected?.workOrderId, noQtyProductionQueue]);

  const [recentEntriesScope, setRecentEntriesScope] = React.useState<"CURRENT_WO" | "GLOBAL">("CURRENT_WO");

  const visibleEntries = React.useMemo(() => {
    let list = entries;
    // Default Recent Entries / runner history to the scoped WO only (stable WO id).
    if (recentEntriesScope === "CURRENT_WO" && effectiveScopedWoId > 0) {
      list = list.filter((e) => Number(e.workOrderLine?.workOrder?.id ?? 0) === effectiveScopedWoId);
    }
    if (entryFilter === "ALL") return list;
    if (entryFilter === "DRAFT") return list.filter((e) => isDraft(e));
    return list.filter((e) => isApproved(e));
  }, [entries, entryFilter, recentEntriesScope, effectiveScopedWoId]);

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

  /** REGULAR: QC next step when the selected WO has any batch awaiting QC. */
  const selectedWoQcPending = React.useMemo(() => {
    if (navigateNoQtyContext || !selected) return false;
    return entries.some(
      (e) =>
        Number(e.workOrderLine?.workOrder?.id ?? 0) === Number(selected.workOrderId) && qcPendingEntry(e),
    );
  }, [navigateNoQtyContext, selected, entries]);

  const selectedWoPendingProductionId = React.useMemo(() => {
    if (!selected) return 0;
    const pending = entries.find(
      (e) =>
        Number(e.workOrderLine?.workOrder?.id ?? 0) === Number(selected.workOrderId) && qcPendingEntry(e),
    );
    return pending?.id ?? 0;
  }, [selected, entries]);

  const regularQcBannerHref = React.useMemo(() => {
    if (!selected || !selectedWoQcPending) return "";
    const ot =
      String(soOrderTypeById[selected.salesOrderId] ?? "").trim() ||
      (fromNoQtySo && selected.salesOrderId === focusSoId ? "NO_QTY" : "NORMAL");
    return buildQcEntryHref({
      salesOrderId: selected.salesOrderId,
      productionId: selectedWoPendingProductionId > 0 ? selectedWoPendingProductionId : null,
      orderType: ot,
      fromStep: "production",
    });
  }, [
    selected,
    selectedWoQcPending,
    selectedWoPendingProductionId,
    soOrderTypeById,
    fromNoQtySo,
    focusSoId,
  ]);

  const productionStickyContext = React.useMemo(
    () =>
      resolveProductionStickyContext({
        selected: selected ?? null,
        woId: effectiveScopedWoId,
        wolId: effectiveScopedWolId,
        workOrders,
        entries: visibleEntries,
        focusSo,
      }),
    [selected, effectiveScopedWoId, effectiveScopedWolId, workOrders, visibleEntries, focusSo],
  );

  const showQcCompletedStrip = React.useMemo(() => {
    if (navigateNoQtyContext) return false;
    if (!canProd) return false;
    if (!selected) return false;
    // Show "QC completed" only for the currently selected WO line (never previous cycles / other lines).
    const rows = entries.filter((e) => Number(e?.workOrderLine?.id ?? 0) === Number(selected.id));
    if (rows.length === 0) return false;
    if (!rows.some((e) => isApproved(e))) return false;
    return !rows.some((e) => qcPendingEntry(e));
  }, [navigateNoQtyContext, canProd, selected, entries]);

  /** Approved production exists — show RM consumption / production report for audit. */
  const showProductionReport = React.useMemo(() => {
    const hasApprovedOnWo = entries.some(
      (e) => Number(e.workOrderLine?.workOrder?.id ?? 0) === effectiveScopedWoId && isApproved(e),
    );
    return shouldShowScopedProductionReport({
      workOrderId: effectiveScopedWoId,
      hasApprovedProductionOnWorkOrder: hasApprovedOnWo,
      navigateNoQtyContext: useHardenedProductionShell,
      executionSummary: scopedExecutionSummary,
      regularSo: isRegularFlow
        ? {
            enabled: true,
            reportPending: Boolean(regularSoCoverage?.reportPending),
            woTargetBalance: regularSoCoverage?.woTargetBalance ?? selectedMetrics?.remainingQty ?? null,
          }
        : null,
    });
  }, [
    effectiveScopedWoId,
    entries,
    useHardenedProductionShell,
    scopedExecutionSummary,
    isRegularFlow,
    regularSoCoverage?.reportPending,
    regularSoCoverage?.woTargetBalance,
    selectedMetrics?.remainingQty,
  ]);

  const showProductionWorkspaceCompactLayout = React.useMemo(
    () =>
      shouldShowProductionWorkspaceCompactLayout({
        showProductionReport,
        workOrderId: effectiveScopedWoId,
        canOperate: canProd,
        navigateNoQtyContext,
        isGreenLevelContext: navigateGreenLevelContext,
        regularReportPending: Boolean(isRegularFlow && regularSoCoverage?.reportPending),
        hideNoQtyAddProductionEntry: hideScopedProductionEntry,
        woIdFromUrlValid,
        workOrderLineIdFromUrlValid,
      }),
    [
      showProductionReport,
      effectiveScopedWoId,
      canProd,
      navigateNoQtyContext,
      navigateGreenLevelContext,
      isRegularFlow,
      regularSoCoverage?.reportPending,
      hideScopedProductionEntry,
      woIdFromUrlValid,
      workOrderLineIdFromUrlValid,
    ],
  );

  const useGreenLevelWorkbenchLayout = navigateGreenLevelContext && !showProductionWorkspaceCompactLayout;

  const noQtyPremiumViewport = React.useMemo(
    () =>
      navigateNoQtyContext &&
      shouldUseNoQtyPremiumViewportWorkspace({
        navigateNoQtyContext: true,
        showNoQtyScopedProductionCard: showNoQtyScopedProductionCard,
      }),
    [navigateNoQtyContext, showNoQtyScopedProductionCard],
  );

  const greenLevelPremiumViewport = React.useMemo(
    () =>
      shouldUseGreenLevelPremiumViewportWorkspace({
        isGreenLevelContext: navigateGreenLevelContext,
        showGreenLevelScopedProductionCard,
        showProductionWorkspaceCompactLayout,
      }),
    [navigateGreenLevelContext, showGreenLevelScopedProductionCard, showProductionWorkspaceCompactLayout],
  );

  const usePremiumViewport = noQtyPremiumViewport || greenLevelPremiumViewport;

  const useProductionPageNaturalScroll = React.useMemo(
    () =>
      shouldUseProductionPageNaturalScroll({
        noQtyPremiumViewport,
        greenLevelPremiumViewport,
      }),
    [noQtyPremiumViewport, greenLevelPremiumViewport],
  );

  const embedNoQtyRecentEntries = React.useMemo(
    () =>
      shouldEmbedNoQtyRecentEntriesInLoggingWorkbench({
        usePremiumViewport,
        showProductionWorkspaceCompactLayout,
      }),
    [usePremiumViewport, showProductionWorkspaceCompactLayout],
  );

  const showNoQtyOperatorChrome = React.useMemo(
    () =>
      shouldShowNoQtyOperatorWorkstationChrome({
        embedNoQtyRecentEntries,
        showProductionWorkspaceCompactLayout,
      }),
    [embedNoQtyRecentEntries, showProductionWorkspaceCompactLayout],
  );

  const noQtyWoSummary = React.useMemo(() => {
    if (!navigateNoQtyContext || effectiveScopedWoId <= 0) return null;
    const woRow = workOrders.find((w) => w.id === effectiveScopedWoId);
    const line =
      (effectiveScopedWolId > 0
        ? flatLines.find((l) => l.id === effectiveScopedWolId && l.workOrderId === effectiveScopedWoId)
        : null) ??
      flatLines.find((l) => l.workOrderId === effectiveScopedWoId) ??
      (selected?.workOrderId === effectiveScopedWoId ? selected : null);
    const soId = focusSoIdValid ? focusSoId : line?.salesOrderId ?? 0;
    return {
      workOrderId: effectiveScopedWoId,
      woLabel: displayWorkOrderNo(effectiveScopedWoId, woRow?.docNo ?? null),
      soLabel: displaySalesOrderNo(soId, soId === focusSoId ? focusSo?.docNo ?? null : null),
      itemName: line?.fgItem.itemName ?? "—",
      customerName: focusSo?.customerName ?? null,
      plannedQty: selectedMetrics?.woLineQty ?? null,
      producedQty: selectedMetrics?.usedQty ?? null,
      remainingQty: selectedMetrics?.remainingQty ?? null,
    };
  }, [
    navigateNoQtyContext,
    effectiveScopedWoId,
    effectiveScopedWolId,
    workOrders,
    flatLines,
    selected,
    focusSoIdValid,
    focusSoId,
    focusSo,
    selectedMetrics,
  ]);

  const greenLevelWoSummary = React.useMemo(() => {
    if (!navigateGreenLevelContext || effectiveScopedWoId <= 0) return null;
    const woRow = workOrders.find((w) => w.id === effectiveScopedWoId);
    const line =
      (effectiveScopedWolId > 0
        ? flatLines.find((l) => l.id === effectiveScopedWolId && l.workOrderId === effectiveScopedWoId)
        : null) ??
      flatLines.find((l) => l.workOrderId === effectiveScopedWoId) ??
      (selected?.workOrderId === effectiveScopedWoId ? selected : null);
    return {
      workOrderId: effectiveScopedWoId,
      woLabel: displayWorkOrderNo(effectiveScopedWoId, woRow?.docNo ?? null),
      soLabel: GREEN_LEVEL_STOCK_SOURCE_LABEL,
      itemName: line?.fgItem.itemName ?? "—",
      customerName: GREEN_LEVEL_CUSTOMER_DISPLAY_LABEL,
      plannedQty: selectedMetrics?.woLineQty ?? null,
      producedQty: selectedMetrics?.usedQty ?? null,
      remainingQty: selectedMetrics?.remainingQty ?? null,
    };
  }, [
    navigateGreenLevelContext,
    effectiveScopedWoId,
    effectiveScopedWolId,
    workOrders,
    flatLines,
    selected,
    selectedMetrics,
  ]);

  const regularWoSummary = React.useMemo(() => {
    if (!isRegularFlow || effectiveScopedWoId <= 0) return null;
    const woRow = workOrders.find((w) => w.id === effectiveScopedWoId);
    const line =
      (effectiveScopedWolId > 0
        ? flatLines.find((l) => l.id === effectiveScopedWolId && l.workOrderId === effectiveScopedWoId)
        : null) ??
      flatLines.find((l) => l.workOrderId === effectiveScopedWoId) ??
      (selected?.workOrderId === effectiveScopedWoId ? selected : null);
    const soId = focusSoIdValid ? focusSoId : line?.salesOrderId ?? woRow?.salesOrderId ?? 0;
    return {
      workOrderId: effectiveScopedWoId,
      woLabel: displayWorkOrderNo(effectiveScopedWoId, woRow?.docNo ?? null),
      soLabel: displaySalesOrderNo(soId, soId === focusSoId ? focusSo?.docNo ?? null : null),
      itemName: line?.fgItem.itemName ?? "—",
      customerName: focusSo?.customerName ?? null,
      plannedQty: regularSoCoverage?.woPlannedQty ?? selectedMetrics?.woLineQty ?? null,
      producedQty: regularSoCoverage?.producedQty ?? selectedMetrics?.usedQty ?? null,
      remainingQty: regularSoCoverage?.woTargetBalance ?? selectedMetrics?.remainingQty ?? null,
      flowBadge: "REGULAR SALES ORDER",
      reportPending: Boolean(regularSoCoverage?.reportPending),
      soQty: regularSoCoverage?.soDemandQty ?? null,
      unit: line?.fgItem.unit ?? selected?.fgItem.unit ?? null,
    };
  }, [
    isRegularFlow,
    effectiveScopedWoId,
    effectiveScopedWolId,
    workOrders,
    flatLines,
    selected,
    focusSoIdValid,
    focusSoId,
    focusSo,
    selectedMetrics,
    regularSoCoverage,
  ]);

  const hardenedWoSummary = isGreenLevelFlow
    ? greenLevelWoSummary
    : isRegularFlow
      ? regularWoSummary
      : noQtyWoSummary;

  const productionWorkspaceWoSummary = showProductionWorkspaceCompactLayout ? hardenedWoSummary : null;

  const productionReportClosureReady =
    showProductionWorkspaceCompactLayout &&
    showProductionReport &&
    Boolean(hardenedWoSummary);

  /** Single stable surface while Finalize→Report settles — never the Continue runner. */
  const showOpeningProductionReportGate =
    forceProductionReportTransition && !productionReportClosureReady;

  /** Hide header/strip Continue while mandatory Production Report is open or pending. */
  const hideContinueForProductionReport = shouldHideContinueWhileProductionReportPending({
    showProductionReport,
    showCompactClosureLayout: showProductionWorkspaceCompactLayout,
    forceProductionReportTransition,
    showOpeningProductionReportGate,
    pendingShortfallDecision: noQtyPendingShortfallDecision,
    executionStatus: scopedExecutionSummary?.executionStatus,
  });

  React.useEffect(() => {
    if (
      shouldClearProductionReportTransition({
        transitionWorkOrderId: productionReportTransitionWoId,
        showProductionReport,
        showCompactClosureLayout: productionReportClosureReady,
      })
    ) {
      // Defer clear one frame so the compact report layout paints before gate drops.
      const t = window.setTimeout(() => setProductionReportTransitionWoId(0), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [productionReportTransitionWoId, showProductionReport, productionReportClosureReady]);

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

  /**
   * Partial production rule: finalized entry QC must not dead-end the process screen when
   * an executable remaining balance remains (Continue Production).
   */
  const hasExecutableRemainingBalance = Boolean(
    selectedMetrics &&
      selectedMetrics.remainingQty > 1e-6 &&
      canProd &&
      !woProductionLifecycleBlocked &&
      !rmProductionEntryBlocked &&
      !latestDraftForSelectedWoLine,
  );

  /** One primary QC / dispatch CTA surface — suppress in-card duplicates when the top strip is shown. */
  const showRegularQcNextStrip = Boolean(
    !navigateNoQtyContext &&
      selectedWoQcPending &&
      (regularQcBannerHref || !canOpenQaFromProduction) &&
      !hasExecutableRemainingBalance,
  );
  const showNoQtyQcNextStrip = Boolean(
    navigateNoQtyContext &&
      showQcNextBanner &&
      (qcBannerHref || !canOpenQaFromProduction) &&
      !hideTopQcNextStrip &&
      !hasExecutableRemainingBalance &&
      !(noQtyAllowShopFloorContinue && selectedMetrics && selectedMetrics.remainingQty > 1e-6),
  );
  const showTopQcNextStrip = showRegularQcNextStrip || showNoQtyQcNextStrip;
  const suppressDuplicateQcWorkflowUi = showTopQcNextStrip;

  const displayHeaderMetrics = React.useMemo(
    () => resolveProductionStickyMetrics({ selectedMetrics, wolId: effectiveScopedWolId, flatLines }),
    [selectedMetrics, effectiveScopedWolId, flatLines],
  );

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
    if (!fromNoQtySo && !showRegularRmReadiness && selectedMetrics.remainingQty <= 0) {
      w.push("No remaining quantity on this line.");
    }
    if (
      !fromNoQtySo &&
      !showRegularRmReadiness &&
      producedQtyValid &&
      producedQtyParsed != null &&
      selectedMetrics.remainingQty > 0 &&
      producedQtyParsed > selectedMetrics.remainingQty
    ) {
      w.push("Entered quantity exceeds remaining capacity.");
    }
    if (
      showRegularRmReadiness &&
      rmEntryQtyCap != null &&
      !rmReadinessLoading &&
      producedQtyParsed != null &&
      producedQtyParsed > rmEntryQtyCap + 1e-6
    ) {
      w.push(
        `Maximum allowed is ${fmtProdQty(rmEntryQtyCap)} ${selected?.fgItem.unit ?? "Nos"} based on RM issued to this WO.`,
      );
    }
    if (
      showNoQtyRmStatus &&
      rmEntryQtyCap != null &&
      !rmReadinessLoading &&
      producedQtyValid &&
      producedQtyParsed != null &&
      producedQtyParsed > rmEntryQtyCap + 1e-6
    ) {
      w.push(`Entered quantity exceeds issued RM capacity (${fmtProdQty(rmEntryQtyCap)}).`);
    }
    if ((fromNoQtySo || showRegularRmReadiness) && selectedMetrics && producedQtyParsed != null) {
      const editingQty = editing?.workOrderLine?.id === wolId ? Number(editing.producedQty ?? 0) : 0;
      const cumulative = Math.max(0, selectedMetrics.usedQty - editingQty) + producedQtyParsed;
      const excess = cumulative - selectedMetrics.woLineQty;
      if (excess > 1e-6) {
        w.push(
          `Production exceeds the planned WO quantity by ${fmtProdQty(excess)} and will be treated as excess production.`,
        );
      }
    }
    return w;
  }, [
    fromNoQtySo,
    showRegularRmReadiness,
    selectedMetrics,
    producedQtyParsed,
    producedQtyValid,
    rmEntryQtyCap,
    rmAllowedNowQty,
    rmReadinessLoading,
    selected,
    showNoQtyRmStatus,
    editing,
    wolId,
    fmtProdQty,
  ]);

  async function refresh(): Promise<{ flatLines: FlatLine[]; entries: ProdEntryRow[] }> {
    const includeWorkOrderLineId =
      Number(editing?.workOrderLine?.id ?? 0) > 0
        ? Number(editing?.workOrderLine?.id)
        : workOrderLineIdFromUrlValid
          ? workOrderLineIdFromUrl
          : 0;
    const includeQs = includeWorkOrderLineId > 0 ? `&includeWorkOrderLineId=${includeWorkOrderLineId}` : "";
    /** When `salesOrderId` is in the URL — or derivable from URL WO — scope pending WOs to that SO. */
    let soScopeId = focusSoIdValid ? focusSoId : 0;
    if (!(soScopeId > 0) && woIdFromUrlValid) {
      const fromState = workOrders.find((w) => w.id === woIdFromUrlPick)?.salesOrderId ?? 0;
      if (fromState > 0) soScopeId = fromState;
    }
    const soScopeQs = soScopeId > 0 && !navigateGreenLevelContext ? `&salesOrderId=${soScopeId}` : "";
    const scopedWoForEntries =
      recentEntriesScope === "CURRENT_WO" && effectiveScopedWoId > 0 ? effectiveScopedWoId : 0;
    const entriesQs = (() => {
      const params = new URLSearchParams();
      if (scopedWoForEntries > 0) {
        params.set("workOrderId", String(scopedWoForEntries));
      } else if (navigateNoQtyContext && focusSoIdValid) {
        params.set("salesOrderId", String(focusSoId));
        if (effectiveNoQtyCycleId != null) {
          params.set("cycleId", String(effectiveNoQtyCycleId));
        }
      }
      const q = params.toString();
      return q ? `?${q}` : "";
    })();
    const [w, e] = await Promise.all([
      apiFetch<WoRow[]>(`/api/production/work-orders?pendingOnly=1${includeQs}${soScopeQs}`),
      apiFetch<ProdEntryRow[]>(`/api/production/production-entries${entriesQs}`),
    ]);
    setWorkOrders((prev) => {
      const prevSig = prev
        .flatMap((wo) =>
          (wo.lines ?? []).map(
            (l) => `${wo.id}:${l.id}:${Number(l.approvedProducedQty ?? 0)}:${Number(l.remainingQty ?? 0)}`,
          ),
        )
        .join("|");
      const nextSig = w
        .flatMap((wo) =>
          (wo.lines ?? []).map(
            (l) => `${wo.id}:${l.id}:${Number(l.approvedProducedQty ?? 0)}:${Number(l.remainingQty ?? 0)}`,
          ),
        )
        .join("|");
      if (prevSig === nextSig) return prev;
      return w;
    });
    setEntries((prev) => {
      const prevSig = prev.map((r) => `${r.id}:${r.producedQty ?? 0}:${r.workflowStatus ?? ""}`).join("|");
      const nextSig = e.map((r) => `${r.id}:${r.producedQty ?? 0}:${r.workflowStatus ?? ""}`).join("|");
      if (prevSig === nextSig) return prev;
      return e;
    });
    setExecutionPanelRefreshTick((t) => t + 1);
    const flatLines = w.flatMap((wo) =>
      wo.lines.map((l) => ({
        ...l,
        workOrderId: wo.id,
        salesOrderId: wo.salesOrderId,
      })),
    );
    return { flatLines, entries: e };
  }

  React.useEffect(() => {
    if (navigateNoQtyContext && focusSoIdValid && effectiveNoQtyCycleId != null) return;
    // NO_QTY deep-link: wait for cycle-scoped refresh so WO/line auto-pick does not run twice.
    if (focusSoIdValid && (fromNoQtySo || noQtyContinueProductionIntent) && cycleIdFromUrl != null) return;
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setInitialRefreshDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick]);

  // NO_QTY: once cycleId is known (flow API or URL), refetch entries scoped to that cycle.
  React.useEffect(() => {
    if (productionFlowMode !== "NO_QTY") return;
    if (!focusSoIdValid && noQtyWorkbenchSoId <= 0) return;
    if (effectiveNoQtyCycleId == null) return;
    refresh()
      .catch(() => {
        /* refresh sets its own error */
      })
      .finally(() => setInitialRefreshDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionFlowMode, focusSoIdValid, noQtyWorkbenchSoId, focusSoId, effectiveNoQtyCycleId, liveTick]);

  // Recent Entries scope toggle (current WO vs loaded SO/cycle history).
  React.useEffect(() => {
    if (!initialRefreshDone) return;
    void refresh().catch(() => {
      /* refresh sets its own error */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentEntriesScope, effectiveScopedWoId]);

  // When scoped to a confirmed NO_QTY SO, show a context-aware empty state if nothing is eligible.
  React.useEffect(() => {
    if (confirmedNoQtySoId <= 0) {
      setNoQtyEmptyMsg("");
      return;
    }
    if (!canProd) return;
    if (flatLines.length > 0) {
      setNoQtyEmptyMsg("");
      return;
    }
    apiFetch<{ reason: string; message: string }>(
      `/api/production/no-qty-so/${confirmedNoQtySoId}/production-context`,
    )
      .then((ctx) => setNoQtyEmptyMsg(ctx?.message ?? ""))
      .catch(() => setNoQtyEmptyMsg(""));
  }, [confirmedNoQtySoId, canProd, flatLines.length]);

  // Load SO header for NO_QTY guided production (URL may omit `source=no_qty_so` until order type is resolved).
  React.useEffect(() => {
    if (productionFlowMode !== "NO_QTY") {
      setFocusSo(null);
      return;
    }
    const soId = noQtyWorkbenchSoId > 0 ? noQtyWorkbenchSoId : focusSoIdValid ? focusSoId : 0;
    if (!(soId > 0)) {
      setFocusSo(null);
      return;
    }
    apiFetch<any>(`/api/sales-orders/${soId}`)
      .then((so) => {
        const customerName = so?.customer?.name ?? so?.po?.customer?.name ?? "—";
        const cycleNo =
          so?.orderType === "NO_QTY"
            ? null
            : so?.currentCycle?.cycleNo != null
              ? Number(so.currentCycle.cycleNo)
              : null;
        const currentCycleId = so?.currentCycle?.id != null ? Number(so.currentCycle.id) : null;
        const closed =
          String(so?.internalStatus ?? "") === "COMPLETED" ||
          String(so?.internalStatus ?? "") === "CLOSED" ||
          String(so?.processStage?.key ?? "") === "COMPLETED";
        setFocusSo({
          id: soId,
          customerName,
          docNo: so?.docNo ?? null,
          cycleNo,
          currentCycleId,
          cycleStatus: closed ? "Closed Cycle" : "Active Cycle",
        });
      })
      .catch(() =>
        setFocusSo({
          id: soId,
          customerName: "—",
          docNo: null,
          cycleNo: null,
          currentCycleId: null,
          cycleStatus: "Active Cycle",
        }),
      );
  }, [productionFlowMode, noQtyWorkbenchSoId, focusSoId, focusSoIdValid]);

  React.useEffect(() => {
    if (productionFlowMode !== "NONE") return;
    if (flowResolutionSoId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(soOrderTypeById, flowResolutionSoId)) return;
    void ensureSoOrderType(flowResolutionSoId);
  }, [productionFlowMode, flowResolutionSoId, soOrderTypeById, ensureSoOrderType]);

  // Keep UI consistent with backend eligibility filtering (especially NO_QTY cycle rules).
  // If previously selected WO is no longer present, clear selection and hide the entry form.
  React.useEffect(() => {
    if (woId !== 0 && !workOrders.some((w) => w.id === woId)) {
      clearWoLineSelection({ force: true });
      setError(null);
    }
  }, [workOrders, woId, clearWoLineSelection]);

  React.useEffect(() => {
    if (wolId === 0) return;
    if (flatLines.some((l) => l.id === wolId)) return;
    if (urlWoSelectionAuthorityRef.current) {
      const woStillPending =
        woIdFromUrlValid && workOrders.some((w) => w.id === woIdFromUrlPick);
      if (woStillPending) return;
    }
    clearWoLineSelection();
  }, [flatLines, wolId, woIdFromUrlValid, woIdFromUrlPick, workOrders, clearWoLineSelection]);

  React.useEffect(() => {
    if (!canProd || flatLines.length === 0 || wolId !== 0) return;
    if (!initialRefreshDone) return;
    if (productionFlowMode === "NONE") return;
    /** URL deep-link owns WO/line selection — handled by dedicated effect above. */
    if (urlWoSelectionAuthority) return;
    if (urlSelectionAppliedRef.current) return;

    const autoPickTarget = pickFirstExecutableProductionLine(flatLines);
    if (!autoPickTarget) return;

    // Canonical workspace list: never auto-open (prevents Back ↔ overview-clear flicker loop).
    if (showProductionWorkspace) {
      void shouldAutoOpenExecutableFromProductionWorkspaceList();
      return;
    }
    if (suppressWorkspaceAutoOpenRef.current) return;

    if (productionFlowMode === "NO_QTY") {
      if (!showNoQtyScopedProductionCard) return;
      if (noQtyQcPendingStable) {
        if (!(woIdFromUrlValid || workOrderLineIdFromUrlValid)) {
          return;
        }
      }
      if (noQtyNextRsReady && !noQtyAllowShopFloorContinue) {
        if (woId !== 0 || wolId !== 0) {
          clearWoLineSelection();
        }
        return;
      }
      if (noQtyContinueProductionIntent && !noQtyContinueAutoPickDoneRef.current) {
        const target = pickNoQtyContinueProductionLine();
        if (target) {
          noQtyContinueAutoPickDoneRef.current = true;
          openExecutableProductionLine(target);
          return;
        }
      }
      if (Number.isFinite(workOrderLineIdFromUrl) && workOrderLineIdFromUrl > 0) {
        const byUrl = flatLines.find((l) => l.id === workOrderLineIdFromUrl);
        if (byUrl) {
          applyLine(byUrl);
          return;
        }
      }
      const fifoReady =
        noQtyAutoPickLines.length > 0
          ? pickFirstExecutableProductionLine(noQtyAutoPickLines) ?? noQtyAutoPickLines[0]
          : autoPickTarget;
      if (fifoReady) {
        openExecutableProductionLine(fifoReady);
        return;
      }
      if (!noQtyContinueProductionIntent && (woId !== 0 || wolId !== 0)) {
        clearWoLineSelection();
      }
      return;
    }

    if (productionFlowMode === "GREEN_LEVEL") {
      if (!showGreenLevelScopedProductionCard) return;
      if (woIdFromUrlValid && workOrders.some((w) => w.id === woIdFromUrlPick)) {
        const forWo = sortFlatByPriority(flatLines.filter((l) => l.workOrderId === woIdFromUrlPick));
        if (forWo.length > 0) {
          applyLine(forWo[0]);
          return;
        }
      }
      return;
    }

    if (productionFlowMode !== "REGULAR") return;

    if (woIdFromUrlValid && workOrders.some((w) => w.id === woIdFromUrlPick)) {
      const forWo = sortFlatByPriority(flatLines.filter((l) => l.workOrderId === woIdFromUrlPick));
      if (forWo.length > 0) {
        applyLine(forWo[0]);
        return;
      }
    }
    openExecutableProductionLine(autoPickTarget);
  }, [
    canProd,
    flatLines,
    wolId,
    applyLine,
    productionFlowMode,
    showNoQtyScopedProductionCard,
    showGreenLevelScopedProductionCard,
    focusSoIdValid,
    focusSoId,
    workOrders,
    woIdFromUrlValid,
    woIdFromUrlPick,
    resetProducedQty,
    noQtyAutoPickLines,
    noQtyNextRsReady,
    noQtyQcPendingStable,
    noQtyContinueProductionIntent,
    noQtyAllowShopFloorContinue,
    pickNoQtyContinueProductionLine,
    clearWoLineSelection,
    showProductionWorkspace,
    ensureSoOrderType,
    isCarryForwardLine,
    workOrderLineIdFromUrl,
    urlWoSelectionAuthority,
    openExecutableProductionLine,
    initialRefreshDone,
  ]);

  React.useEffect(() => {
    if (productionFlowMode !== "NO_QTY" || !showNoQtyScopedProductionCard) return;
    if (!noQtyNextRsReady || noQtyAllowShopFloorContinue) return;
    if (urlWoSelectionAuthorityRef.current) return;
    if (woId === 0 && wolId === 0) return;
    clearWoLineSelection();
  }, [
    productionFlowMode,
    showNoQtyScopedProductionCard,
    noQtyNextRsReady,
    noQtyAllowShopFloorContinue,
    woId,
    wolId,
    clearWoLineSelection,
  ]);

  React.useEffect(() => {
    const l = flatLines.find((x) => x.id === wolId);
    if (l) setWoId((prev) => (prev === l.workOrderId ? prev : l.workOrderId));
  }, [wolId, flatLines]);

  /** After QC completes on produced qty, WO remainder is carry-forward — drop selection so the entry form is not the default view. */
  React.useEffect(() => {
    if (productionFlowMode !== "NO_QTY" || !showNoQtyScopedProductionCard || noQtyAllowShopFloorContinue) return;
    if (urlWoSelectionAuthorityRef.current) return;
    const sel = flatLines.find((x) => x.id === wolId);
    if (!sel) return;
    if ((noQtyQcPendingByWolId.get(sel.id) ?? 0) > 1e-6) return;
    if (!isCarryForwardLine(sel, "NO_QTY")) return;
    clearWoLineSelection();
  }, [
    entries,
    flatLines,
    wolId,
    productionFlowMode,
    showNoQtyScopedProductionCard,
    noQtyAllowShopFloorContinue,
    isCarryForwardLine,
    noQtyQcPendingByWolId,
    clearWoLineSelection,
  ]);

  function advanceAfterSave(flat: FlatLine[], prevWolId: number) {
    const sorted = sortFlatByPriority(flat);
    if (sorted.length === 0) {
      clearWoLineSelection();
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
    setEditQty(String(Number(e.producedQty)));
    setEditDate(toYmd(e.date));
  }

  async function onPost(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (shiftProductionQtyLocked) {
      setError(shiftQtyLockMessage ?? SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE);
      return;
    }
    if (regularCreateFormLockedByDraft) {
      setError(
        "A draft production batch already exists for this line. Edit, approve, or cancel it above before recording another batch.",
      );
      return;
    }
    if (!wolId || !flatLines.some((l) => l.id === wolId)) {
      setError("Select a work order line.");
      return;
    }
    if (!producedQtyValid || producedQtyParsed == null) {
      setError("Enter produced quantity.");
      return;
    }
    if (woProductionLifecycleBlocked && woProductionLifecycleMessage) {
      setError(woProductionLifecycleMessage);
      return;
    }
    if (rmProductionEntryBlocked) {
      setError(
        rmReadiness?.gate === "WAITING_STORE_ISSUE"
          ? "Waiting for Store RM Issue."
          : "Production is blocked until a material request is submitted and Store issues RM.",
      );
      return;
    }
    if (productionQuantityCompleted) {
      setError(PRODUCTION_QUANTITY_COMPLETED_MESSAGE);
      return;
    }
    if (shouldHideRegularProductionEntryForReport(regularSoCoverage)) {
      setError(
        regularSoCoverage?.reportPending
          ? "Production entry is locked while the Production Report is pending."
          : "SO demand is already covered. End production and continue to the Production Report.",
      );
      return;
    }
    if (
      (showRegularRmReadiness || showNoQtyRmStatus) &&
      rmEntryQtyCap != null &&
      producedQtyParsed > rmEntryQtyCap + 1e-6
    ) {
      setError(
        `Maximum allowed is ${fmtProdQty(rmEntryQtyCap)} based on RM issued to this WO.`,
      );
      return;
    }
    const prevWol = wolId;
    setPosting(true);
    try {
      const created = await apiFetch<{
        prod?: ProdEntryRow;
        shiftLink?: ProdEntryRow["shiftLink"];
      }>("/api/production/production-entries", {
        method: "POST",
        body: JSON.stringify({
          workOrderLineId: wolId,
          producedQty: producedQtyParsed,
          date: prodDate,
          ...(selectedRunAllocationId != null && selectedRunAllocationId > 0
            ? { runAllocationId: selectedRunAllocationId }
            : {}),
        }),
      });
      if (created?.shiftLink) {
        setLastCreatedShiftLink(created.shiftLink);
      }
      setEditing(null);
      resetProducedQtyField();
      const { flatLines: nextFlat } = await refresh();
      // NO_QTY: do not auto-advance / push operators to complete production.
      // Keep the current selection stable; partial production is a valid state.
      if (!showNoQtyScopedProductionCard) {
        advanceAfterSave(nextFlat, prevWol);
      }
      window.requestAnimationFrame(() => producedQtyRef.current?.focus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setPosting(false);
    }
  }

  async function saveEditDraft() {
    if (!editing) return;
    setError(null);
    if (shiftProductionQtyLocked) {
      setError(shiftQtyLockMessage ?? SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE);
      return;
    }
    const editQtyNum = Number(editQty);
    if (!Number.isFinite(editQtyNum) || editQtyNum <= 0) {
      setError("Produced qty is required.");
      return;
    }
    if (woProductionLifecycleBlocked && woProductionLifecycleMessage) {
      setError(woProductionLifecycleMessage);
      return;
    }
    if (rmProductionEntryBlocked) {
      setError(
        rmReadiness?.gate === "WAITING_STORE_ISSUE"
          ? "Waiting for Store RM Issue."
          : "Production is blocked until a material request is submitted and Store issues RM.",
      );
      return;
    }
    if (productionQuantityCompleted) {
      setError(PRODUCTION_QUANTITY_COMPLETED_MESSAGE);
      return;
    }
    if (shouldHideRegularProductionEntryForReport(regularSoCoverage)) {
      setError(
        regularSoCoverage?.reportPending
          ? "Production entry is locked while the Production Report is pending."
          : "SO demand is already covered. End production and continue to the Production Report.",
      );
      return;
    }
    if (
      showRegularRmReadiness &&
      rmEntryQtyCap != null &&
      editQtyNum > rmEntryQtyCap + 1e-6
    ) {
      setError(
        `Maximum allowed is ${fmtProdQty(rmEntryQtyCap)} based on RM issued to this WO.`,
      );
      return;
    }
    setEditSaving(true);
    try {
      await apiFetch(`/api/production/production-entries/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({ producedQty: editQtyNum, date: editDate }),
      });
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update draft");
    } finally {
      setEditSaving(false);
    }
  }

  async function afterProductionApproveSuccess(
    _id: number,
    approvedRow: ProdEntryRow | undefined,
    consumptionWarnings?: string[],
    approvalExtras: ApprovalExtras = {},
    remainingDispositionResult?: { outcome?: string; summary?: ProductionExecutionSummary | null } | null,
  ) {
    setEditing(null);
    setNoQtyRmShortage(null);
    const approvedBatchQty = Number(approvedRow?.producedQty ?? 0);
    const pausedWoId = approvedRow ? Number(approvedRow.workOrderLine?.workOrder?.id ?? 0) : 0;
    const wasPause = approvalExtras.remainingDisposition === "PAUSE";
    const awaitsProductionReport =
      approvalExtras.remainingDisposition === "END_WITH_SHORTAGE" ||
      String(remainingDispositionResult?.outcome ?? "").toUpperCase() === "AWAITING_PRODUCTION_REPORT";

    // End / equal / extra: apply report-pending summary BEFORE refresh so the runner never paints.
    if (awaitsProductionReport && pausedWoId > 0) {
      setProductionReportTransitionWoId(pausedWoId);
      const apiSummary = remainingDispositionResult?.summary ?? null;
      const planned = Number(apiSummary?.plannedQty ?? 0);
      const produced = Number(
        apiSummary?.producedQty ??
          (Number(approvedRow?.producedQty ?? 0) > 0
            ? Number(approvedRow?.producedQty)
            : approvedBatchQty),
      );
      const remainder = Number(
        apiSummary?.remainderQty ?? Math.max(0, planned > 0 ? planned - produced : 0),
      );
      const surplus = Number(apiSummary?.surplusQty ?? Math.max(0, produced - planned));
      setNoQtyExecutionSummary({
        workOrderId: pausedWoId,
        workOrderDocNo: apiSummary?.workOrderDocNo ?? null,
        workOrderStatus: String(apiSummary?.workOrderStatus ?? "IN_PROGRESS"),
        executionStatus: "SHORTFALL_PENDING",
        plannedQty: planned,
        producedQty: produced,
        remainderQty: remainder,
        surplusQty: surplus,
        productionPendingQty: 0,
        hasShortfall: remainder > 1e-6,
        hasSurplus: surplus > 1e-6,
        pendingShortfallResolution: true,
        blockReasons: apiSummary?.blockReasons ?? [],
        resolutionReasons: apiSummary?.resolutionReasons ?? [],
        lines: apiSummary?.lines ?? [],
      });
      setCompletionEvaluateTick(0);
      setCompletionEvaluateBatchQty(0);

      const replaceParams = new URLSearchParams();
      if (navigateGreenLevelContext) {
        replaceParams.set("flow", PRODUCTION_FLOW_GREEN_LEVEL);
      } else if (navigateNoQtyContext) {
        replaceParams.set("source", "no_qty_so");
        replaceParams.set("flow", PRODUCTION_FLOW_NO_QTY);
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
      }
      replaceParams.set("workOrderId", String(pausedWoId));
      const wolNav = Number(approvedRow?.workOrderLine?.id ?? effectiveScopedWolId ?? 0);
      if (Number.isFinite(wolNav) && wolNav > 0) {
        replaceParams.set("workOrderLineId", String(wolNav));
      }
      replaceParams.set("focusReport", "1");
      const fromPa = searchParams.get("from");
      const returnTo = searchParams.get("returnTo");
      if (fromPa) replaceParams.set("from", fromPa);
      if (returnTo) replaceParams.set("returnTo", returnTo);
      const nextSearch = `?${replaceParams.toString()}`;
      if (location.search !== nextSearch) {
        navigate(`/production${nextSearch}`, { replace: true });
      }

      // Refresh after optimistic report-pending paint — never before.
      await refresh();
      setExecutionPanelRefreshTick((t) => t + 1);
      toast.showSuccess(
        consumptionWarnings?.length
          ? `Batch finalized — complete Production Report. ${consumptionWarnings.join(" ")}`
          : "Batch finalized and sent to QC. Complete the mandatory Production Report to close this WO.",
      );
      return;
    }

    const { flatLines: nextFlat, entries: nextEntries } = await refresh();
    setExecutionPanelRefreshTick((t) => t + 1);

    if (useHardenedProductionShell && !wasPause) {
      setCompletionEvaluateBatchQty(approvedBatchQty);
      setCompletionEvaluateTick((t) => t + 1);
    }

    // Pause: leave the paused runner — never trap the operator on production inputs.
    if (wasPause && pausedWoId > 0) {
      const qcPendingByWolId = buildQcPendingByWorkOrderLineId(nextEntries);
      const queueLines = buildProductionQueueLines(nextFlat, qcPendingByWolId);
      const advance = resolvePostProductionPauseAdvance({
        pausedWorkOrderId: pausedWoId,
        lines: queueLines,
      });
      resetScopedProductionWorkspaceState();
      clearWoLineSelection({ force: true });
      urlSelectionAppliedRef.current = false;
      urlWoSelectionAuthorityRef.current = false;
      toast.showSuccess(
        consumptionWarnings?.length
          ? `Production paused. ${consumptionWarnings.join(" ")}`
          : "Production paused. Batch sent to QC.",
      );
      if (advance.kind === "advance" && advance.line) {
        const fullLine = nextFlat.find((l) => l.id === advance.line!.id);
        if (fullLine) {
          openExecutableProductionLine(fullLine);
          return;
        }
      }
      navigate(
        buildProductionWorkspaceOverviewHref({
          pwSection: "paused",
          pwFocus: pausedWoId,
        }),
        { replace: true },
      );
      return;
    }

    const woIdNav = pausedWoId;
    if (navigateGreenLevelContext && Number.isFinite(woIdNav) && woIdNav > 0) {
      const replaceParams = new URLSearchParams();
      replaceParams.set("flow", PRODUCTION_FLOW_GREEN_LEVEL);
      replaceParams.set("workOrderId", String(woIdNav));
      const wolNav = Number(approvedRow?.workOrderLine?.id ?? effectiveScopedWolId ?? 0);
      if (Number.isFinite(wolNav) && wolNav > 0) {
        replaceParams.set("workOrderLineId", String(wolNav));
      }
      const nextSearch = `?${replaceParams.toString()}`;
      if (location.search !== nextSearch) {
        navigate(`/production${nextSearch}`, { replace: true });
      }
    } else if (navigateNoQtyContext && Number.isFinite(woIdNav) && woIdNav > 0) {
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
      const nextSearch = `?${replaceParams.toString()}`;
      if (location.search !== nextSearch) {
        navigate(`/production${nextSearch}`, { replace: true });
      }
    }
    if (consumptionWarnings?.length) {
      toast.showSuccess(`Production approved. ${consumptionWarnings.join(" ")}`);
    } else if (!navigateNoQtyContext && !navigateGreenLevelContext && !focusSoIdValid) {
      toast.showSuccess("Production approved.");
    } else if (!navigateNoQtyContext && !navigateGreenLevelContext) {
      toast.showSuccess("Production approved.");
    }
  }

  async function approveDraftDirect(id: number, approvalExtras: ApprovalExtras = {}) {
    if (shiftProductionQtyLocked) {
      setError(shiftQtyLockMessage ?? SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE);
      return;
    }
    const row = entries.find((e) => e.id === id);
    const greenLevelBatch =
      navigateGreenLevelContext || isGreenLevelProductionEntry(row);
    const confirmMsg = greenLevelBatch
      ? "Approve this batch? The batch will move to QC."
      : "Approve this batch? Raw material stock will be issued and the batch will move to QC.";
    if (!window.confirm(confirmMsg)) {
      return;
    }
    setError(null);
    setNoQtyRmShortage(null);
    setRowBusy(id);
    const approvedRow = entries.find((e) => e.id === id);
    try {
      const res = await apiFetch<{
        consumptionWarnings?: string[];
        remainingDispositionResult?: {
          outcome?: string;
          summary?: ProductionExecutionSummary | null;
        } | null;
      }>(`/api/production/production-entries/${id}/approve`, {
        method: "POST",
        body: JSON.stringify(approvalExtras),
      });
      await afterProductionApproveSuccess(
        id,
        approvedRow,
        res.consumptionWarnings,
        approvalExtras,
        res.remainingDispositionResult,
      );
    } catch (err) {
      setProductionReportTransitionWoId(0);
      if (err instanceof ApiRequestError && err.code === "INSUFFICIENT_RM_FOR_NO_QTY_PRODUCTION" && err.body) {
        setNoQtyRmShortage(err.body as NoQtyRmShortagePayload);
        setError(null);
      } else {
        setNoQtyRmShortage(null);
        const msg = err instanceof Error ? err.message : "Approve failed";
        setError(msg);
        toast.showError(msg);
      }
    } finally {
      setRowBusy(null);
    }
  }

  const closeConsumptionApproveModal = React.useCallback(() => {
    setConsumptionApproveId((openId) => {
      if (openId != null) {
        setRowBusy((busy) => (busy === openId ? null : busy));
      }
      return null;
    });
  }, []);

  const onConsumptionPreviewSettled = React.useCallback(() => {
    setRowBusy(null);
  }, []);

  function executeDraftFinalization(id: number, approvalExtras: ApprovalExtras = {}) {
    const row = entries.find((e) => e.id === id);
    if (
      navigateGreenLevelContext ||
      isGreenLevelProductionEntry(row) ||
      !entryUsesRmConsumptionReview(row)
    ) {
      void approveDraftDirect(id, approvalExtras);
      return;
    }
    setRowBusy(id);
    setConsumptionApprovalExtras(approvalExtras);
    setConsumptionApproveId(id);
  }

  function draftFinalizationReview(id: number) {
    const row = entries.find((e) => e.id === id);
    if (!row) return null;
    const lineId = Number(row.workOrderLine?.id ?? 0);
    const line = flatLines.find((l) => Number(l.id) === lineId);
    const planned = line ? linePlannedQty(line) : 0;
    const previouslyFinalized = entries
      .filter((e) => e.id !== id && isApproved(e) && Number(e.workOrderLine?.id ?? 0) === lineId)
      .reduce((sum, e) => sum + Number(e.producedQty ?? 0), 0);
    const currentDraft = Number(row.producedQty ?? 0);
    const remaining = computeReviewFinalizeShortageQty(planned, previouslyFinalized, currentDraft);
    return { row, planned, previouslyFinalized, currentDraft, totalAfter: previouslyFinalized + currentDraft, remaining };
  }

  function approveDraft(id: number) {
    if (shiftProductionQtyLocked) {
      setError(shiftQtyLockMessage ?? SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE);
      return;
    }
    const review = draftFinalizationReview(id);
    const hardened = navigateNoQtyContext || navigateGreenLevelContext || isGreenLevelProductionEntry(review?.row);
    if (review && hardened) {
      setReviewFinalizeEntryId(id);
      setReviewDisposition(null);
      setReviewPauseReason("MACHINE_BREAKDOWN");
      setReviewRemarks("");
      return;
    }
    executeDraftFinalization(id);
  }

  function renderApproveButtonLabel(entryId: number, idleLabel: string, _compact?: boolean): string {
    if (rowBusy !== entryId) return idleLabel;
    return "Opening…";
  }

  function openReverseModal(entry: ProdEntryRow) {
    if (!canOfferProductionReverse(entry, isAdmin)) return;
    const safe = reversibleProductionQty(entry);
    setReverseModalEntry(entry);
    setReverseQtyDraft(
      formatProductionQtyForInput(safe, entry.workOrderLine?.fgItem?.unit ?? selected?.fgItem?.unit),
    );
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
    const unit = reverseModalEntry.workOrderLine?.fgItem?.unit ?? selected?.fgItem?.unit;
    setReverseQtyDraft(formatProductionQtyForInput(Number.isFinite(pq) ? pq : 0, unit));
    setReverseModalError(null);
  }

  async function confirmReverseModal() {
    if (!reverseModalEntry || !isAdmin) return;
    if (shiftProductionQtyLocked) {
      setReverseModalError(shiftQtyLockMessage ?? SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE);
      return;
    }
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
    if (shiftProductionQtyLocked) {
      setError(shiftQtyLockMessage ?? SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE);
      return;
    }
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
        resetProducedQtyField();
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
        resetProducedQtyField();
      }
    },
  });

  const prodQtyBind = shortcutHints.bindField("prodQty", {
    onChange: (e) => onProducedQtyInputChange((e.target as HTMLInputElement).value),
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
  const placeDraftInGreenLevelPrimaryCard =
    showGreenLevelScopedProductionCard && flatLines.length > 0 && canProd;
  const placeDraftInHardenedPrimaryCard = placeDraftInNoQtyPrimaryCard || placeDraftInGreenLevelPrimaryCard;
  const placeDraftAfterRegularProductionCard =
    !fromNoQtySo && !navigateGreenLevelContext && flatLines.length > 0 && canProd;

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

  /** Regular flow: draft on selected line blocks RM Ready and duplicate workflow surfaces. */
  const draftApprovalPendingRegular =
    !navigateNoQtyContext && !navigateGreenLevelContext && Boolean(latestDraftForSelectedWoLine && selected);

  const greenLevelDraftApprovalPending =
    navigateGreenLevelContext && Boolean(latestDraftForSelectedWo) && canProd;

  /** One primary next-action strip per screen state (NO_QTY + regular). */
  const productionPrimaryStrip = React.useMemo((): {
    variant: "action" | "success" | "info" | "blocked";
    title: string;
    subtitle?: string;
    primaryAction?: { label: string; onClick: () => void; testId?: string };
  } | null => {
    if (draftApprovalPendingRegular && latestDraftForSelectedWoLine) {
      return {
        variant: "action",
        title: "Draft Production Entry Awaiting Approval",
        subtitle: `Qty ${fmtProdQty(latestDraftForSelectedWoLine.producedQty)} · Approve, edit, or cancel from the entries table below`,
        primaryAction: {
          label: "Review & Finalize",
          testId: "next-approve-production-draft",
          onClick: () => approveDraft(latestDraftForSelectedWoLine.latest.id),
        },
      };
    }
    if (showRegularRmReadiness && rmReadiness && rmProductionEntryBlocked) {
      const step = buildRmIssueNextStep(rmReadiness, "production-workspace");
      return {
        variant: "blocked",
        title: step.statusTitle,
        subtitle: step.blockingReason
          ? `${step.statusSubtitle ?? ""} · ${step.blockingReason}`
          : step.statusSubtitle,
        primaryAction: {
          label: step.primaryAction.label,
          testId: step.primaryAction.testId,
          onClick: () => {
            if (step.primaryAction.href) navigate(step.primaryAction.href);
          },
        },
      };
    }
    if (!navigateNoQtyContext && woProductionLifecycleBlocked && woProductionLifecycleMessage) {
      const paused = isWorkOrderPausedStatus(selectedWoForLifecycle?.status);
      const hold = !paused && String(selectedWoForLifecycle?.status ?? "").toUpperCase() === "HOLD";
      return {
        variant: "info",
        title: paused
          ? "Work Order paused"
          : hold
            ? workOrderStatusDisplayLabel({
                status: selectedWoForLifecycle?.status ?? "HOLD",
                holdReason: selectedWoForLifecycle?.holdReason,
              })
            : "Production blocked",
        subtitle: woProductionLifecycleMessage,
        primaryAction: paused
          ? {
              label: resumeWoBusy ? "Resuming…" : "Resume Production",
              testId: "next-resume-production",
              onClick: () => {
                const id = selectedWoForLifecycle?.id ?? 0;
                if (!(id > 0) || resumeWoBusy) return;
                setResumeWoBusy(true);
                void resumeWorkOrderApi(id)
                  .then(() => {
                    refresh();
                    navigate(
                      buildProductionWorkspaceOverviewHref({
                        productionBucket: "inProgress",
                        pwSection: "active",
                        pwFocus: id,
                      }),
                      { replace: true },
                    );
                  })
                  .catch((e) => setError(e instanceof Error ? e.message : "Resume failed"))
                  .finally(() => setResumeWoBusy(false));
              },
            }
          : hold
            ? {
                label: "Open work order",
                onClick: () =>
                  navigate(
                    `/work-orders?excludeWo=${selectedWoForLifecycle?.id ?? 0}&so=${selectedWoForLifecycle?.salesOrderId ?? selected?.salesOrderId ?? 0}`,
                  ),
              }
            : undefined,
      };
    }
    if (showTopQcNextStrip) {
      const qcHref = navigateNoQtyContext ? qcBannerHref : regularQcBannerHref;
      if (qcHref) {
        if (!navigateNoQtyContext) {
          const qaSoId = selected?.salesOrderId ?? qcBannerSoId;
          const step = buildProductionQaHandoffStep(
            operatorRole,
            qaSoId,
            selectedWoPendingProductionId > 0 ? selectedWoPendingProductionId : null,
            qcHref,
          );
          return {
            variant: canOpenQaFromProduction && qcHref ? "action" : "info",
            title: step.statusTitle,
            subtitle: step.statusSubtitle,
            primaryAction: canOpenQaFromProduction && qcHref
              ? {
                  label: step.primaryAction.label,
                  testId: step.primaryAction.testId,
                  onClick: () => navigate(qcHref),
                }
              : undefined,
          };
        }
        return {
          variant: canOpenQaFromProduction && qcHref ? "action" : "info",
          title: navigateNoQtyContext ? PRODUCTION_QA_TERMS.QA_PENDING_STRIP : PRODUCTION_QA_TERMS.NEXT_STEP_COMPLETE_QA,
          subtitle: navigateNoQtyContext
            ? canOpenQaFromProduction
              ? "Production is approved."
              : PRODUCTION_QA_TERMS.WAITING_FOR_QA
            : PRODUCTION_QA_TERMS.NEXT_STEP_COMPLETE_QA_NO_QTY,
          primaryAction:
            canOpenQaFromProduction && qcHref
              ? {
                  label: PRODUCTION_QA_TERMS.COMPLETE_QA,
                  onClick: () => navigate(qcHref),
                }
              : undefined,
        };
      }
    }
    if (navigateNoQtyContext && showNoQtyScopedProductionCard) {
      if (noQtyNextRsReady) {
        return {
          variant: "success",
          title: "Next RS Ready",
          subtitle:
            noQtyCarryForwardQtyFromEngine > 1e-6
              ? `Cycle review complete — includes previous cycle shortage (${fmtProdQty(noQtyCarryForwardQtyFromEngine)}). Continue on the NO_QTY agreement page.`
              : noQtyFlowState?.message ?? "Cycle review complete — continue on the NO_QTY agreement page when ready.",
        };
      }
      if (
        roleUi.showProductionDispatchHandoff &&
        noQtyFlowState?.primaryActionForCurrentUser === "DISPATCH" &&
        noQtyFlowState?.nextAction === "DISPATCH" &&
        !entries.some((e) => qcPendingEntry(e))
      ) {
        return {
          variant: "action",
          title: "Dispatch ready",
          subtitle: "Ship QC-passed quantity when stock is available.",
          primaryAction: {
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
          },
        };
      }
      if (
        noQtyShowContinueProductionCta &&
        !hideContinueForProductionReport &&
        selectedMetrics &&
        selectedMetrics.remainingQty > 1e-6 &&
        canProd &&
        flatLines.length > 0 &&
        !latestDraftForSelectedWo &&
        (!noQtyNextRsReady ||
          noQtyFlowState?.roleAllowedOptionalActions?.includes("PRODUCTION") ||
          noQtyFlowState?.optionalActions?.includes("PRODUCTION"))
      ) {
        return {
          variant: "info",
          title: "Production paused",
          subtitle: `Remaining qty: ${fmtProdQty(selectedMetrics.remainingQty)}. Resume to continue on this Work Order.`,
          primaryAction: {
            label: "Continue Production",
            onClick: () => {
              document.getElementById("regular-production-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
            },
          },
        };
      }
      return null;
    }
    if (!showQcNextBanner && showQcCompletedStrip && selected) {
      return {
        variant: "success",
        title: "Next Step: Review or continue downstream",
        subtitle: PRODUCTION_QA_TERMS.CLEARED_QA_SUBTITLE,
        primaryAction: {
          label: PRODUCTION_QA_TERMS.VIEW_QA_ENTRIES,
          onClick: () =>
            navigate(
              buildQcEntryHref({
                salesOrderId: selected.salesOrderId,
                productionId: null,
                orderType: String(soOrderTypeById[selected.salesOrderId] ?? "").trim() || "NORMAL",
                fromStep: "production",
              }),
            ),
        },
      };
    }
    if (
      shouldShowUnusedRmReturnPrimaryStrip({
        rmReadinessLoading,
        entriesLoadSettled: initialRefreshDone,
        draftApprovalPending: draftApprovalPendingRegular,
        workOrderLineId: wolId,
        readinessWorkOrderLineId: rmReadiness?.workOrderLineId,
        hasFinalizedProduced: Number(selectedMetrics?.usedQty ?? 0) > 1e-6,
        returnableQtyTotal: sumReturnableRmQty(rmReadiness?.rmLines),
      })
    ) {
      return {
        variant: "info",
        title: "Unused RM at production",
        subtitle: "Return surplus RM to store (MRN). Does not reverse production consumption.",
        primaryAction: {
          label: "Return unused RM",
          onClick: () =>
            navigate(
              `/production/rm-returns?workOrderId=${rmReadiness!.workOrderId}${
                rmReadiness!.latestPmrId ? `&pmrId=${rmReadiness!.latestPmrId}` : ""
              }`,
            ),
        },
      };
    }
    if (
      !navigateNoQtyContext &&
      showRegularRmReadiness &&
      rmReadiness &&
      !rmProductionEntryBlocked &&
      !regularCreateFormLockedByDraft &&
      !woProductionLifecycleBlocked &&
      !hideContinueForProductionReport &&
      selectedMetrics &&
      selectedMetrics.remainingQty > 1e-6 &&
      canProd &&
      flatLines.length > 0 &&
      !shouldHideEnterProductionCtaInEntryWorkspace({
        alreadyInScopedEntry: effectiveScopedWoId > 0 && wolId > 0,
        runStartEntryBlocked,
      })
    ) {
      const step = buildRmReadyProductionNextStep(selected!.workOrderId, wolId);
      return {
        variant: "action",
        title: step.statusTitle,
        subtitle: step.statusSubtitle,
        primaryAction: {
          label: step.primaryAction.label,
          testId: step.primaryAction.testId,
          onClick: () => {
            document.getElementById("regular-production-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
            window.setTimeout(() => producedQtyRef.current?.focus(), 120);
          },
        },
      };
    }
    // Never show “Next Step: Record production / Continue production” on the scoped WO
    // entry screen — Confirm start (or the entry form itself) is the next action.
    if (
      !shouldSuppressRecordProductionPrimaryStrip({
        alreadyInScopedEntry: effectiveScopedWoId > 0 && wolId > 0,
        runStartEntryBlocked,
      }) &&
      selectedMetrics &&
      selectedMetrics.remainingQty > 1e-6 &&
      canProd &&
      flatLines.length > 0 &&
      !latestDraftForSelectedWo &&
      !regularCreateFormLockedByDraft &&
      !rmProductionEntryBlocked &&
      !woProductionLifecycleBlocked &&
      !hideContinueForProductionReport
    ) {
      const rmCap =
        showRegularRmReadiness && rmReadiness
          ? fmtProdQty(rmReadiness.productionAllowedNowQty)
          : null;
      return {
        variant: "info",
        title: "Next Step: Record production",
        subtitle:
          rmCap != null
            ? `Production allowed now: ${rmCap} ${rmReadiness?.fgUnit || ""}. WO balance: ${fmtProdQty(selectedMetrics.remainingQty)}.`
            : `Remaining production pending: ${fmtProdQty(selectedMetrics.remainingQty)}`,
        primaryAction: {
          label: "Continue production",
          onClick: () => {
            document.getElementById("regular-production-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
            window.setTimeout(() => producedQtyRef.current?.focus(), 120);
          },
        },
      };
    }
    return null;
  }, [
    showTopQcNextStrip,
    qcBannerHref,
    regularQcBannerHref,
    qcBannerSoId,
    selectedWoPendingProductionId,
    selectedWoQcPending,
    firstPendingProductionEntryId,
    navigateNoQtyContext,
    showNoQtyScopedProductionCard,
    roleUi.showPlanningWorkflowActions,
    roleUi.showProductionDispatchHandoff,
    canCreateNextRs,
    noQtyNextRsReady,
    noQtyFlowState,
    noQtyCarryForwardQtyFromEngine,
    entries,
    selectedMetrics,
    canProd,
    flatLines.length,
    latestDraftForSelectedWo,
    latestDraftForSelectedWoLine,
    regularCreateFormLockedByDraft,
    draftApprovalPendingRegular,
    showQcNextBanner,
    showQcCompletedStrip,
    selected,
    focusSoId,
    effectiveNoQtyCycleId,
    navigate,
    toast,
    soOrderTypeById,
    showRegularRmReadiness,
    rmReadiness,
    rmReadinessLoading,
    initialRefreshDone,
    rmProductionEntryBlocked,
    woProductionLifecycleBlocked,
    woProductionLifecycleMessage,
    selectedWoForLifecycle,
    resumeWoBusy,
    noQtyShowContinueProductionCta,
    hideContinueForProductionReport,
    effectiveScopedWoId,
    wolId,
    runStartEntryBlocked,
  ]);

  const productionPrimaryStripCoversDraft = draftApprovalPendingRegular;
  const productionPrimaryStripCoversRmIssue = productionPrimaryStrip?.title === "Waiting for RM Issue";
  const productionPrimaryStripCoversRmReady = productionPrimaryStrip?.title === "RM Ready – Enter Production";
  const productionPrimaryStripCoversPause = productionPrimaryStrip?.title === "Work Order paused";
  const productionPrimaryStripCoversMaterialCard =
    productionPrimaryStripCoversDraft ||
    productionPrimaryStripCoversRmIssue ||
    productionPrimaryStripCoversRmReady ||
    productionPrimaryStrip?.title === "Unused RM at production";

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
            displayWorkOrderNo(selected!.workOrderId, woRow?.docNo ?? null),
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
      <div className="erp-workflow-actions shrink-0">
        <Button
          type="button"
          size="sm"
          variant="default"
          className={compact ? "h-8 px-3 text-[11px] font-semibold shadow-sm" : "h-9 px-3 text-xs font-semibold shadow-sm"}
          disabled={rowBusy === latest.id}
          onClick={() => approveDraft(latest.id)}
        >
          {renderApproveButtonLabel(latest.id, "Review & Finalize")}
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
                    {displayWorkOrderNo(selected!.workOrderId, woRow?.docNo ?? null)}
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
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-950">Draft · approve</div>
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
            <div className="text-[14px] font-semibold tracking-tight text-amber-950">Draft · approve</div>
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

  /** Top strip owns draft approval — hide duplicate Approve/Edit/Cancel on ledger rows. */
  const showCompactDraftApprovalStrip = React.useMemo(() => {
    if (draftApprovalPendingRegular) return true;
    if (!latestDraftForSelectedWo || !selected || !(flatLines.length > 0) || !canProd) return false;
    return (
      placeDraftInHardenedPrimaryCard ||
      placeDraftAfterRegularProductionCard ||
      (Boolean(fromNoQtySo) && !showNoQtyScopedProductionCard)
    );
  }, [
    draftApprovalPendingRegular,
    latestDraftForSelectedWo,
    selected,
    flatLines.length,
    canProd,
    placeDraftInHardenedPrimaryCard,
    placeDraftAfterRegularProductionCard,
    fromNoQtySo,
    showNoQtyScopedProductionCard,
  ]);

  const openedFromWorkOrderWorkspace = fromParam.trim().toLowerCase() === "work-order-workspace";
  const openedFromProductionWorkspace = fromParam.trim().toLowerCase() === "production-workspace";

  const productionRegularBackNav = React.useMemo(() => {
    const sid =
      selected && Number(selected.salesOrderId) > 0
        ? Number(selected.salesOrderId)
        : focusSoIdValid
          ? focusSoId
          : 0;
    const back = resolveProductionRegularBack({
      fromParam,
      sourceParam: source,
      fromStepParam,
      returnToParam: searchParams.get("returnTo") ?? "",
      salesOrderId: sid,
      workOrderId:
        selected && Number(selected.workOrderId) > 0
          ? Number(selected.workOrderId)
          : woId > 0
            ? woId
            : woIdFromUrlValid
              ? woIdFromUrlPick
              : 0,
      productionBucket: productionBucketFilter,
      hasActiveDraft: Boolean(latestDraftForSelectedWoLine || draftApprovalPendingRegular),
    });
    if (openedFromWorkOrderWorkspace || openedFromProductionWorkspace || fromPendingActions) return back;
    if (navigateNoQtyContext || navigateGreenLevelContext) return null;
    return back;
  }, [
    navigateNoQtyContext,
    navigateGreenLevelContext,
    openedFromWorkOrderWorkspace,
    openedFromProductionWorkspace,
    fromPendingActions,
    selected?.salesOrderId,
    focusSoIdValid,
    focusSoId,
    fromParam,
    fromStepParam,
    source,
    searchParams,
    productionBucketFilter,
    selected?.workOrderId,
    woId,
    woIdFromUrlValid,
    woIdFromUrlPick,
    latestDraftForSelectedWoLine,
    draftApprovalPendingRegular,
  ]);

  /** REGULAR-only WO context for chrome (no hybrid NO_QTY shell). */
  const activeWoForRegularShell = React.useMemo(() => {
    if (!isRegularFlow) return null;
    if (woId > 0) return workOrders.find((w) => w.id === woId) ?? null;
    if (selected && selected.workOrderId > 0) return workOrders.find((w) => w.id === selected.workOrderId) ?? null;
    return null;
  }, [isRegularFlow, woId, selected, workOrders]);

  const regularWorkflowStageLabel = React.useMemo(() => {
    if (navigateNoQtyContext) return "";
    if (hideContinueForProductionReport) {
      return productionStageLabelForReportPending({
        executionStatus: scopedExecutionSummary?.executionStatus,
      });
    }
    if (draftApprovalPendingRegular) return "Draft Pending";
    if (woProductionLifecycleBlocked && isWorkOrderPausedStatus(selectedWoForLifecycle?.status)) return "Paused";
    if (productionWaitingRmForCapacity && showRegularRmReadiness) return "Waiting for RM issue";
    if (selectedMetrics && selectedMetrics.remainingQty > 1e-6) {
      const produced = Number(selectedMetrics.usedQty ?? 0);
      return produced > 1e-6 ? "Continue" : "Ready";
    }
    if (productionQuantityCompleted) return "Line complete";
    if (selectedWoQcPending && (regularQcBannerHref || !canOpenQaFromProduction)) return "QC Pending";
    if (showQcCompletedStrip) return "Complete";
    if (selectedMetrics && selectedMetrics.remainingQty <= 1e-6) return "Line complete";
    if (!selected && wolId > 0) {
      const lineEntries = entries.filter((e) => Number(e.workOrderLine?.id ?? 0) === wolId);
      if (lineEntries.some((e) => qcPendingEntry(e)) && !(selectedMetrics && selectedMetrics.remainingQty > 1e-6)) {
        return "QC Pending";
      }
      if (lineEntries.some((e) => isDraft(e))) return "Draft Pending";
      if (lineEntries.some((e) => isApproved(e))) return "Approved";
    }
    if (productionStickyContext) return "Production";
    return "Production";
  }, [
    navigateNoQtyContext,
    hideContinueForProductionReport,
    scopedExecutionSummary?.executionStatus,
    draftApprovalPendingRegular,
    latestDraftForSelectedWoLine,
    selectedWoQcPending,
    regularQcBannerHref,
    woProductionLifecycleBlocked,
    selectedWoForLifecycle?.status,
    productionWaitingRmForCapacity,
    productionQuantityCompleted,
    showRegularRmReadiness,
    selectedMetrics,
    showQcCompletedStrip,
    selected,
    wolId,
    entries,
    productionStickyContext,
  ]);

  const productionEntryMaxQty = React.useMemo(
    () =>
      (fromNoQtySo || showRegularRmReadiness) && rmEntryQtyCap != null
        ? rmEntryQtyCap
        : resolveProductionEntryMaxQty(selectedMetrics?.remainingQty, rmEntryQtyCap),
    [fromNoQtySo, showRegularRmReadiness, selectedMetrics?.remainingQty, rmEntryQtyCap],
  );

  const showProductionOperatorIdentity =
    !showProductionWorkspace &&
    !showProductionWorkspaceCompactLayout &&
    wolId > 0 &&
    Boolean(selectedMetrics) &&
    Boolean(selected);

  const productionOperatorFlowLabel = React.useMemo(() => {
    if (navigateGreenLevelContext || isGreenLevelFlow) return "Green Level";
    if (navigateNoQtyContext || fromNoQtySo) return "NO_QTY";
    return "Regular";
  }, [navigateGreenLevelContext, isGreenLevelFlow, navigateNoQtyContext, fromNoQtySo]);

  const productionOperatorFlowContextLabel = React.useMemo(() => {
    if (navigateGreenLevelContext || isGreenLevelFlow) {
      return productionFlowDisplayLabel(PRODUCTION_FLOW_GREEN_LEVEL);
    }
    if (navigateNoQtyContext || fromNoQtySo) {
      return productionFlowDisplayLabel(PRODUCTION_FLOW_NO_QTY);
    }
    return productionFlowDisplayLabel(PRODUCTION_FLOW_REGULAR);
  }, [navigateGreenLevelContext, isGreenLevelFlow, navigateNoQtyContext, fromNoQtySo]);

  const productionOperatorStatusLabel = React.useMemo(() => {
    if (hideContinueForProductionReport) {
      return productionStageLabelForReportPending({
        executionStatus: scopedExecutionSummary?.executionStatus,
      });
    }
    if (navigateGreenLevelContext && selectedGreenLevelQueueRow?.statusLabel) {
      return selectedGreenLevelQueueRow.statusLabel;
    }
    if (navigateNoQtyContext && noQtyCycleDisplayStatus?.label) return noQtyCycleDisplayStatus.label;
    return regularWorkflowStageLabel;
  }, [
    hideContinueForProductionReport,
    scopedExecutionSummary?.executionStatus,
    navigateGreenLevelContext,
    selectedGreenLevelQueueRow?.statusLabel,
    navigateNoQtyContext,
    noQtyCycleDisplayStatus?.label,
    regularWorkflowStageLabel,
  ]);

  const productionOperatorIdentityProps = React.useMemo(() => {
    if (!showProductionOperatorIdentity || !selected) return null;
    const woRow =
      effectiveScopedWoId > 0
        ? workOrders.find((w) => w.id === effectiveScopedWoId)
        : workOrders.find((w) => w.id === selected.workOrderId);
    const woLabel = displayWorkOrderNo(woRow?.id ?? selected.workOrderId, woRow?.docNo ?? null);
    const planned = Number(selectedMetrics?.woLineQty ?? 0);
    const finalized = Number(selectedMetrics?.usedQty ?? 0);
    const draftQty = Number(latestDraftForSelectedWoLine?.producedQty ?? 0);
    const rmSupportedMax =
      effectiveRmReadiness?.rmSupportedCumulativeCapacityQty != null
        ? Number(effectiveRmReadiness.rmSupportedCumulativeCapacityQty)
        : rmAllowedNowQty != null
          ? finalized + Number(rmAllowedNowQty)
          : 0;
    const beforeDraft =
      rmEntryQtyCap != null && draftQty > 1e-6
        ? Number(rmEntryQtyCap) + draftQty
        : rmEntryQtyCap != null
          ? Number(rmEntryQtyCap)
          : Math.max(0, rmSupportedMax - finalized);
    const projection = resolveRegularSoProductionDraftProjection({
      plannedQty: planned,
      finalizedProducedQty: finalized,
      activeDraftQty: draftQty,
      rmSupportedMaximumQty: rmSupportedMax,
      rmSupportedEntryCapacityBeforeDraft: beforeDraft,
    });
    return {
      woLabel,
      itemName: selected.fgItem.itemName,
      flowLabel: productionOperatorFlowLabel,
      flowContextLabel: productionOperatorFlowContextLabel,
      statusLabel: productionOperatorStatusLabel,
      plannedQty: planned,
      finalizedProducedQty: projection.finalizedProducedQty,
      producedQty: projection.finalizedProducedQty,
      activeDraftQty: projection.hasActiveDraft ? projection.activeDraftQty : null,
      remainingQty: projection.plannedTargetRemainingQty,
      remainingLabel: showRegularRmReadiness || fromNoQtySo ? "Target Remaining" : "Remaining",
      extraRmCapacityQty:
        showRegularRmReadiness || fromNoQtySo ? projection.extraRmCapacityVsPlanQty : null,
      projectedExtraQty: projection.hasActiveDraft ? projection.projectedExtraQty : null,
      remainingRmCapacityAfterDraftQty: projection.hasActiveDraft
        ? projection.remainingRmSupportedAfterDraftQty
        : null,
      unit: selected.fgItem.unit ?? null,
    };
  }, [
    showProductionOperatorIdentity,
    selected,
    effectiveScopedWoId,
    workOrders,
    productionOperatorFlowLabel,
    productionOperatorFlowContextLabel,
    productionOperatorStatusLabel,
    selectedMetrics,
    latestDraftForSelectedWoLine,
    effectiveRmReadiness,
    rmAllowedNowQty,
    rmEntryQtyCap,
    showRegularRmReadiness,
    fromNoQtySo,
  ]);

  const fillOperatorRemainingQty = React.useCallback(() => {
    // NO_QTY: existing behaviour fills RM-supported max (WO plan is a target, not the fill).
    if (fromNoQtySo) {
      const cap = Math.max(0, rmEntryQtyCap ?? selectedMetrics?.remainingQty ?? 0);
      producedQtyUserTouchedRef.current = true;
      setProducedQtyStr(fmtProdQtyForInput(cap));
      return;
    }
    const fill = resolveUseRemainingQtyFill(selectedMetrics?.remainingQty, rmEntryQtyCap);
    producedQtyUserTouchedRef.current = true;
    setProducedQtyStr(fmtProdQtyForInput(fill));
  }, [fromNoQtySo, selectedMetrics?.remainingQty, rmEntryQtyCap, fmtProdQtyForInput, setProducedQtyStr]);

  const fillOperatorRmSupportedMaxQty = React.useCallback(() => {
    const cap = Math.max(0, Number(rmEntryQtyCap ?? 0));
    producedQtyUserTouchedRef.current = true;
    setProducedQtyStr(fmtProdQtyForInput(cap));
  }, [rmEntryQtyCap, fmtProdQtyForInput, setProducedQtyStr]);

  const submitOperatorEntryFromQty = React.useCallback(() => {
    if (!posting && createFormCanSubmit) {
      createFormRef.current?.requestSubmit();
    }
  }, [posting, createFormCanSubmit]);

  const renderOperatorEntryFields = (opts?: { saveButtonTitle?: string }) => (
    <ProductionOperatorEntryFields
      prodDate={prodDate}
      onProdDateChange={setProdDate}
      producedQtyRef={producedQtyRef}
      prodQtyBind={prodQtyBind}
      producedQtyStr={producedQtyStr}
      prodQtyPlaceholder={operatorProdQtyPlaceholder}
      unit={selected?.fgItem.unit ?? null}
      disabled={rmProductionEntryBlocked || productionQuantityCompleted || shiftProductionQtyLocked}
      runStartConfirmLocked={runStartEntryBlocked}
      maxAllowedQty={productionEntryMaxQty}
      maxLabelPrefix={
        fromNoQtySo || showRegularRmReadiness ? "Maximum allowed from issued RM" : "Max"
      }
      producedQtyValid={producedQtyValid}
      wolId={wolId}
      rmReadinessLoading={rmReadinessLoading}
      rmAllowedNowQty={rmAllowedNowQty}
      rmProductionEntryBlocked={
        rmProductionEntryBlocked ||
        productionQuantityCompleted ||
        runStartEntryBlocked ||
        shiftProductionQtyLocked
      }
      showRmCapHint={!productionOperatorIdentityProps && !hardenedWoSummary}
      posting={posting}
      createFormCanSubmit={createFormCanSubmit}
      useRemainingDisabled={
        posting ||
        !selectedMetrics ||
        (selectedMetrics?.remainingQty ?? 0) <= 0 ||
        Boolean(rmProductionEntryBlocked) ||
        productionQuantityCompleted ||
        runStartEntryBlocked ||
        shiftProductionQtyLocked
      }
      onUseRemaining={fillOperatorRemainingQty}
      showUseRmSupportedMax={Boolean(showRegularRmReadiness || fromNoQtySo) && rmEntryQtyCap != null}
      useRmSupportedMaxDisabled={
        posting ||
        !(rmEntryQtyCap != null && rmEntryQtyCap > 1e-6) ||
        Boolean(rmProductionEntryBlocked) ||
        productionQuantityCompleted ||
        runStartEntryBlocked
      }
      onUseRmSupportedMax={fillOperatorRmSupportedMaxQty}
      prodSaveFocusBind={prodSaveFocusBind}
      onProdQtyEnter={submitOperatorEntryFromQty}
      onMarkProdQtyShortcut={() => shortcutHints.markFieldShortcutUsed("prodQty")}
      onMarkProdSaveShortcut={() => shortcutHints.markFieldShortcutUsed("prodSave")}
      shortcutHints={shortcutHints}
      prodDemoHl={prodDemoHl}
      saveButtonTitle={
        opts?.saveButtonTitle ??
        (shiftProductionQtyLocked
          ? shiftQtyLockMessage ?? SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE
          : runStartEntryBlocked
            ? PRODUCTION_ENTRY_AWAIT_RUN_CONFIRM_MESSAGE
            : undefined)
      }
      warnings={[
        ...(productionWarnings ?? []),
        ...(shiftQtyLockMessage ? [shiftQtyLockMessage] : []),
      ]}
      shiftLinkHint={productionShiftLinkHint}
    />
  );

  const renderProductionQuantityCompletedNotice = () => (
    <p
      className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-[12px] font-medium text-slate-800"
      data-testid="production-quantity-completed-notice"
    >
      {PRODUCTION_QUANTITY_COMPLETED_MESSAGE}
    </p>
  );

  const productionWorkbenchIdentity = React.useMemo(() => {
    if (productionOperatorIdentityProps) return productionOperatorIdentityProps;
    if (!hardenedWoSummary) return null;
    return {
      woLabel: hardenedWoSummary.woLabel,
      itemName: hardenedWoSummary.itemName,
      flowLabel: productionOperatorFlowLabel,
      flowContextLabel: productionOperatorFlowContextLabel,
      statusLabel: productionOperatorStatusLabel,
      plannedQty: hardenedWoSummary.plannedQty,
      producedQty: hardenedWoSummary.producedQty,
      remainingQty: hardenedWoSummary.remainingQty,
      unit: selected?.fgItem?.unit ?? null,
    };
  }, [
    productionOperatorIdentityProps,
    hardenedWoSummary,
    productionOperatorFlowLabel,
    productionOperatorFlowContextLabel,
    productionOperatorStatusLabel,
    selected?.fgItem?.unit,
  ]);

  const showProductionOperatorWorkbench = Boolean(
    !showProductionWorkspace &&
      !showProductionWorkspaceCompactLayout &&
      canProd &&
      productionWorkbenchIdentity &&
      (showProductionOperatorIdentity ||
        (embedNoQtyRecentEntries && wolId > 0) ||
        (showNoQtyOperatorChrome && wolId > 0)),
  );

  const activeShiftDeepLinkLoadState = React.useMemo((): "loading" | "wo_missing" | "ready" | null => {
    if (!activeShiftRunDeepLink) return null;
    if (productionIdentityUnresolved || !initialRefreshDone) return "loading";
    if (woIdFromUrlValid && !workOrders.some((w) => w.id === woIdFromUrlPick)) return "wo_missing";
    return "ready";
  }, [
    activeShiftRunDeepLink,
    productionIdentityUnresolved,
    initialRefreshDone,
    woIdFromUrlValid,
    woIdFromUrlPick,
    workOrders,
  ]);

  const showActiveShiftRunConfirmShell = Boolean(
    activeShiftRunDeepLink &&
      activeShiftDeepLinkLoadState === "ready" &&
      effectiveScopedWoId > 0 &&
      canProd &&
      !showProductionWorkspace &&
      !showProductionWorkspaceCompactLayout &&
      !showProductionOperatorWorkbench,
  );

  const activeShiftBackHref =
    shiftSessionIdFromUrl > 0 ? `/shift-production/sessions/${shiftSessionIdFromUrl}` : "/shift-production";

  const operatorOpenWoQueueRows = React.useMemo((): ProductionOperatorOpenWoRow[] => {
    return sortedFlatLines
      .filter((l) => l.id !== wolId)
      .map((l) => {
        const rem = lineRemaining(l);
        const woDoc = workOrders.find((w) => w.id === l.workOrderId)?.docNo ?? null;
        return {
          key: l.id,
          woLabel: navigateNoQtyContext ? undefined : displayWorkOrderNo(l.workOrderId, woDoc),
          itemName: l.fgItem.itemName,
          remainingLabel: fmtProdQty(rem, l.fgItem.unit),
          statusLabel: openWoQueueStatusLabel(rem),
          hideWoColumn: navigateNoQtyContext,
          selected: wolId === l.id,
          onOpen: () => applyLine(l),
        };
      });
  }, [sortedFlatLines, wolId, workOrders, navigateNoQtyContext, fmtProdQty, applyLine]);

  const noQtyEmbedOpenWoQueueRows = React.useMemo((): ProductionOperatorOpenWoRow[] => {
    return noQtyWorkQueueRows
      .filter((l) => l.id !== wolId)
      .map((l) => ({
        key: l.id,
        woLabel: displayWorkOrderNo(l.workOrderId, workOrders.find((w) => w.id === l.workOrderId)?.docNo ?? null),
        itemName: l.fgItem.itemName,
        remainingLabel: fmtProdQty(l.balance, l.fgItem.unit),
        statusLabel: openWoQueueStatusLabel(l.balance, l.queueStatus),
        onOpen: () => openExecutableProductionLine(l),
      }));
  }, [noQtyWorkQueueRows, wolId, workOrders, fmtProdQty, openExecutableProductionLine]);

  const renderScopedProductionBottomQueue = () => {
    if (navigateGreenLevelContext) {
      return (
        <GreenLevelProductionWorkQueuePanel
          variant="secondary"
          containedScroll={!useProductionPageNaturalScroll}
          rows={greenLevelOtherQueueRows}
          selectedLineId={effectiveScopedWolId}
          onRowAction={requestGreenLevelRowSwitch}
          fmtProdQty={fmtProdQty}
        />
      );
    }
    return (
      <ProductionOperatorOpenWoQueue
        rows={noQtyEmbedOpenWoQueueRows}
        totalOpenCount={noQtyWorkQueueRows.length}
        emptyMessage="No other work orders pending for this cycle."
      />
    );
  };

  const renderProductionOperatorWorkbench = (opts: {
    entry: React.ReactNode;
    alerts?: React.ReactNode;
    bottomQueue?: React.ReactNode;
    afterQueue?: React.ReactNode;
  }) => {
    if (!productionWorkbenchIdentity) return null;
    return (
      <ProductionOperatorWorkbench
        identity={productionWorkbenchIdentity}
        alerts={opts.alerts}
        entry={opts.entry}
        recentPanel={renderRecentEntriesPanel(false, {
          operatorWorkbench: true,
          containedScroll: true,
        })}
        bottomQueue={
          opts.bottomQueue ?? (
            <ProductionOperatorOpenWoQueue
              rows={operatorOpenWoQueueRows}
              totalOpenCount={sortedFlatLines.length}
              emptyMessage="No other work orders pending."
            />
          )
        }
        afterQueue={opts.afterQueue}
      />
    );
  };

  const productionOperatorHeaderCompressed =
    Boolean(productionWorkbenchIdentity) &&
    (showProductionOperatorWorkbench || showNoQtyOperatorChrome);

  /** Single SO/WO/Item context — hidden when flow identity bar already covers it. */
  const productionCompactContextBar =
    !productionWorkbenchIdentity &&
    !navigateNoQtyContext &&
    !showProductionWorkspace &&
    (selected || productionStickyContext) &&
    !(isRegularFlow && selected && Number(selected.salesOrderId) > 0) ? (
      <OperationalContextBar className="rounded-md border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-2 py-1 text-[11px] shadow-sm">
        <span className="font-semibold text-slate-600">SO</span>
        <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-sky-900">
          {(() => {
            const soId = selected?.salesOrderId ?? productionStickyContext?.salesOrderId ?? 0;
            if (!(soId > 0)) return "—";
            const soDoc =
              selected && selected.salesOrderId === focusSoId
                ? focusSo?.docNo
                : productionStickyContext?.soDocNo ?? (soId === focusSoId ? focusSo?.docNo : null);
            return displaySalesOrderNo(soId, soDoc);
          })()}
        </span>
        <OpCtxSep />
        <span className="font-semibold text-slate-600">WO</span>
        <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-900">
          {(() => {
            const id =
              woId > 0
                ? woId
                : selected?.workOrderId ??
                  productionStickyContext?.workOrderId ??
                  activeWoForRegularShell?.id ??
                  0;
            if (!(id > 0)) return "—";
            const woDoc =
              activeWoForRegularShell?.id === id
                ? activeWoForRegularShell?.docNo
                : productionStickyContext?.woDocNo ?? workOrders.find((w) => w.id === id)?.docNo ?? null;
            return displayWorkOrderNo(id, woDoc);
          })()}
        </span>
        <OpCtxSep />
        <span className="text-slate-500">Item</span>
        <span className="max-w-[12rem] truncate font-semibold text-slate-900">
          {selected?.fgItem.itemName ?? productionStickyContext?.itemName ?? "—"}
        </span>
        <OpCtxSep />
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Status
        </span>
        <span className="font-semibold text-slate-900">
          {regularWorkflowStageLabel}
        </span>
        {displayHeaderMetrics && (selected || productionStickyContext) ? (
          <>
            <OpCtxSep />
            <span className="text-slate-500">Planned</span>
            <span className="font-bold tabular-nums text-slate-900">{fmtProdQty(displayHeaderMetrics.woLineQty)}</span>
            <OpCtxSep />
            <span className="text-slate-500">Produced</span>
            <span className="font-bold tabular-nums text-slate-900">{fmtProdQty(displayHeaderMetrics.usedQty)}</span>
            <OpCtxSep />
            <span className="text-emerald-800">Remaining</span>
            <span className="font-bold tabular-nums text-emerald-950">{fmtProdQty(displayHeaderMetrics.remainingQty)}</span>
          </>
        ) : null}
      </OperationalContextBar>
    ) : null;

  const activeShiftContextStrip =
    activeShiftDeepLink && effectiveScopedWoId > 0 ? (
      <div
        className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-emerald-300/80 bg-emerald-50/90 px-2.5 py-1.5 text-[12px] text-emerald-950"
        data-testid="active-shift-run-context-strip"
      >
        <span className="font-bold">Active shift run</span>
        {shiftSessionIdFromUrl > 0 ? (
          <Link
            className="font-semibold text-teal-800 underline"
            to={`/shift-production/sessions/${shiftSessionIdFromUrl}`}
          >
            Open Active Shift
          </Link>
        ) : null}
        {runAllocationIdFromUrl > 0 ? (
          <span className="tabular-nums text-emerald-900/80">Run #{runAllocationIdFromUrl}</span>
        ) : null}
        {runSegmentIdFromUrl > 0 ? (
          <span className="tabular-nums text-emerald-900/80">Segment #{runSegmentIdFromUrl}</span>
        ) : null}
        {machineIdFromUrl > 0 ? (
          <span className="tabular-nums text-emerald-900/80">Machine #{machineIdFromUrl}</span>
        ) : null}
        <span className="font-medium text-emerald-900">
          {activeShiftWorkspaceCue === ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START
            ? "Next: Confirm Machine Start"
            : activeShiftWorkspaceCue === ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION
              ? "Next: Record Production"
              : "Continue this run — do not start another"}
        </span>
        {linkedShiftOverdue ? (
          <p
            className="basis-full m-0 text-[12px] font-medium text-amber-900"
            role="status"
            data-testid="shift-overdue-banner"
          >
            {linkedShiftOverdueMessage || SHIFT_OVERDUE_MESSAGE}
          </p>
        ) : null}
      </div>
    ) : null;

  const renderRecentEntriesPanel = (
    embedded: boolean,
    opts?: { containedScroll?: boolean; operatorWorkbench?: boolean },
  ) => (
    <ProductionRecentEntriesPanel
      embedded={embedded}
      operatorWorkbench={opts?.operatorWorkbench}
      containedScroll={opts?.containedScroll ?? !useProductionPageNaturalScroll}
      navigateNoQtyContext={navigateNoQtyContext}
      navigateGreenLevelContext={navigateGreenLevelContext}
      fromNoQtySo={fromNoQtySo}
      focusSoIdValid={focusSoIdValid}
      effectiveNoQtyCycleId={effectiveNoQtyCycleId}
      visibleEntries={visibleEntries}
      entryFilter={entryFilter}
      onEntryFilterChange={setEntryFilter}
      recentEntriesScope={recentEntriesScope}
      onRecentEntriesScopeChange={setRecentEntriesScope}
      showRecentEntriesScopeToggle={effectiveScopedWoId > 0}
      workOrdersCount={workOrders.length}
      showProductionWorkspace={showProductionWorkspace}
      canProd={canProd}
      rowBusy={rowBusy}
      suppressDuplicateQcWorkflowUi={suppressDuplicateQcWorkflowUi}
      canOpenQaFromProduction={canOpenQaFromProduction}
      showCompactDraftApprovalStrip={showCompactDraftApprovalStrip}
      latestDraftForSelectedWo={latestDraftForSelectedWo}
      isAdmin={isAdmin}
      onOpenEdit={openEdit}
      onApproveDraft={approveDraft}
      onDeleteDraft={deleteDraft}
      qcEntryHrefForEntry={qcEntryHrefForEntry}
      onOpenReverse={openReverseModal}
      renderApproveButtonLabel={renderApproveButtonLabel}
    />
  );

  const main = (
    <OperatorPageBody
      className={cn(
        canProd && flatLines.length > 0 && "pb-3",
        "gap-1",
        !useProductionPageNaturalScroll &&
          (navigateNoQtyContext
            ? cn(
                "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden max-[800px]:max-h-none max-[800px]:overflow-y-auto",
                noQtyPremiumViewport
                  ? showNoQtyOperatorChrome
                    ? "lg:h-[calc(100dvh-7.75rem)]"
                    : "lg:h-[calc(100dvh-10.5rem)]"
                  : "lg:h-[calc(100dvh-11.25rem)]",
              )
            : showProductionWorkspace
              ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden lg:h-[calc(100dvh-10rem)] max-[800px]:max-h-none max-[800px]:overflow-y-auto"
              : "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden lg:h-[calc(100dvh-13.25rem)] max-[800px]:max-h-none max-[800px]:overflow-y-auto"),
      )}
    >
      {fromNoQtySo && !embedNoQtyRecentEntries ? (
        <div className="mb-0.5">
          <DemoFlowBanner />
        </div>
      ) : null}

      {showNoQtyOptionalPriorCycleStrip ? (
        <div className="rounded border border-slate-200/90 bg-slate-50/95 px-2 py-1 text-[12px] font-medium text-slate-700">
          Optional production from previous cycle
        </div>
      ) : null}
      {error ? <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[13px] text-red-800">{error}</div> : null}
      {productionWorkbenchIdentity && !showNoQtyOperatorChrome && !showProductionOperatorWorkbench ? (
        <ProductionOperatorIdentityBar {...productionWorkbenchIdentity} className="shrink-0" />
      ) : null}
      {woProductionLifecycleBlocked && woProductionLifecycleMessage && !productionPrimaryStripCoversPause && !draftApprovalPendingRegular ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
          {selectedWoPaused ? (
            <>
              <div className="font-semibold">Work Order paused</div>
              <p className="mt-1 text-[12px] leading-snug text-amber-900">
                Accepted FG stock is kept in store. Production can be resumed later.
              </p>
              {pausedWoQtyStrip ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-5">
                  <div>
                    <dt className="text-amber-800/80">Planned</dt>
                    <dd className="font-bold tabular-nums">{fmtProdQty(pausedWoQtyStrip.plannedQty)}</dd>
                  </div>
                  <div>
                    <dt className="text-amber-800/80">Produced</dt>
                    <dd className="font-bold tabular-nums">{fmtProdQty(pausedWoQtyStrip.producedQty)}</dd>
                  </div>
                  <div>
                    <dt className="text-amber-800/80">QC accepted</dt>
                    <dd className="font-bold tabular-nums">{fmtProdQty(pausedWoQtyStrip.qcAcceptedQty)}</dd>
                  </div>
                  <div>
                    <dt className="text-amber-800/80">Dispatched</dt>
                    <dd className="font-bold tabular-nums">
                      {fmtProdQty(pausedFgBalance?.dispatchedQty ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-amber-800/80">Remaining production</dt>
                    <dd className="font-bold tabular-nums">{fmtProdQty(pausedWoQtyStrip.remainingProductionQty)}</dd>
                  </div>
                </dl>
              ) : null}
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-amber-800 text-white hover:bg-amber-900"
                  disabled={resumeWoBusy}
                  onClick={() => {
                    const id = selectedWoForLifecycle?.id ?? 0;
                    if (!(id > 0)) return;
                    setResumeWoBusy(true);
                    void resumeWorkOrderApi(id)
                      .then(() => {
                        refresh();
                        navigate(
                          buildProductionWorkspaceOverviewHref({
                            productionBucket: "inProgress",
                            pwSection: "active",
                            pwFocus: id,
                          }),
                          { replace: true },
                        );
                      })
                      .catch((e) => setError(e instanceof Error ? e.message : "Resume failed"))
                      .finally(() => setResumeWoBusy(false));
                  }}
                >
                  {resumeWoBusy ? "Resuming…" : "Resume Production"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="font-semibold">Production paused — </span>
              {woProductionLifecycleMessage}
              {String(selectedWoForLifecycle?.status ?? "").toUpperCase() === "HOLD" ? (
                <span className="mt-1 block">
                  <Link
                    to={`/work-orders?excludeWo=${selectedWoForLifecycle?.id ?? 0}&so=${selectedWoForLifecycle?.salesOrderId ?? selected?.salesOrderId ?? 0}`}
                    className="font-medium text-amber-900 underline underline-offset-2"
                  >
                    Resume on Work Orders
                  </Link>
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {noQtyRmShortage?.shortages?.length ? (
        <div className="rm-shortage-panel rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
          <h3 className="text-sm font-semibold text-amber-950">RM shortage detected</h3>
          <p className="mt-1 text-xs font-medium text-amber-900/90">
            Store owns procurement and RM purchase. Production can report the shortage and track status — do not create PO
            from here.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {noQtyRmShortage.shortages!.map((s) => (
              <li key={s.rmItemId}>
                {s.rmItemName} | Req: {formatRmQuantity(s.requiredQty, s.unitName)} | Avl:{" "}
                {formatRmQuantity(s.availableQty, s.unitName)} | Short:{" "}
                {formatRmQuantity(s.shortageQty, s.unitName)}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {noQtyRmShortage.context?.workOrderId ? (
              <Link
                to={rmControlCenterHref({
                  workOrderId: noQtyRmShortage.context.workOrderId,
                  onlyBlocked: true,
                  returnTo: "production",
                })}
                className={cn(buttonVariants({ size: "sm" }), "h-8 no-underline")}
              >
                Open RM Control Center
              </Link>
            ) : null}
            {noQtyRmShortage.context?.workOrderId ? (
              <Link
                to={materialRequestsQueueHref({
                  workOrderId: noQtyRmShortage.context.workOrderId,
                  workOrderLineId: noQtyRmShortage.context.workOrderLineId,
                  returnTo: "production-workspace",
                })}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 no-underline")}
              >
                Material Requests
              </Link>
            ) : null}
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
      {productionPrimaryStrip && !showHardenedScopedProductionCard ? (
        <NextStepStrip
          visible
          density="compact"
          variant={productionPrimaryStrip.variant}
          title={productionPrimaryStrip.title}
          subtitle={productionPrimaryStrip.subtitle}
          className="gap-1.5 rounded-md px-2 py-1.5"
          primaryAction={productionPrimaryStrip.primaryAction}
        />
      ) : null}
      {activeShiftContextStrip}
      {!showProductionWorkspaceCompactLayout && !showProductionOperatorWorkbench ? productionCompactContextBar : null}
      {showProductionWorkspace ? (
        <div className="flex flex-col gap-2" data-testid="production-workspace-dashboard">
          <div className="shrink-0 space-y-2">
            <ProductionWorkspaceStatusStrip />
            <OperationalProductionWorkspace onOpenRow={openProductionFromWorkspace} productionBucket={productionBucketFilter} />
          </div>
          <div className="pb-2">{renderRecentEntriesPanel(false, { containedScroll: false })}</div>
        </div>
      ) : showHardenedScopedProductionCard ? (
        <div
          className={cn(
            "min-w-0",
            usePremiumViewport && !useProductionPageNaturalScroll && "flex min-h-0 flex-1 flex-col overflow-hidden",
          )}
        >
            {!canProd ? (
              <p className="text-[13px] text-slate-600">Production / Admin only.</p>
            ) : !initialRefreshDone ? (
              <ErpPageLoader variant="workspace" hint="Loading production workspace…" />
            ) : navigateGreenLevelContext && greenLevelProductionQueueRows.length === 0 ? (
              <p className="text-[13px] text-slate-600">No eligible Green Level work orders.</p>
            ) : !navigateGreenLevelContext && !flatLines.length ? (
              <p className="text-[13px] text-slate-600">
                {noQtyProductionStatusMsg ||
                  noQtyEmptyMsg ||
                  (focusSo ? `No eligible work orders · ${focusSo.customerName}` : "No eligible work orders")}
              </p>
            ) : (
              <>
                <Card
                  className={cn(
                    "erp-op-workspace-primary min-w-0",
                    showProductionOperatorWorkbench &&
                      embedNoQtyRecentEntries &&
                      "border-0 bg-transparent shadow-none",
                    useGreenLevelWorkbenchLayout
                      ? "overflow-visible"
                      : embedNoQtyRecentEntries
                        ? "flex min-h-0 flex-1 flex-col overflow-visible"
                        : "overflow-hidden",
                  )}
                >
                  {showProductionWorkspaceCompactLayout ? (
                    <CardContent className="space-y-1.5 px-2 py-1.5">
                      <form ref={createFormRef} onSubmit={onPost} className="flex min-h-0 flex-col">
                        {showProductionWorkspaceCompactLayout && productionWorkspaceWoSummary ? (
                          <ProductionWorkspaceCompactPanel
                            key={scopedProductionWorkspaceKey(effectiveScopedWoId, effectiveScopedWolId)}
                            workOrderId={effectiveScopedWoId}
                            orderType={isGreenLevelFlow ? "GREEN_LEVEL" : "NO_QTY"}
                            woSummary={productionWorkspaceWoSummary}
                            canOperate={canProd}
                            executionRefreshKey={executionPanelRefreshTick}
                            reportRefreshKey={liveTick}
                            evaluateTick={completionEvaluateTick}
                            evaluateBatchQty={completionEvaluateBatchQty}
                            onChanged={() => {
                              void refresh();
                            }}
                            onSummaryChange={handleScopedWoExecutionSummaryChange}
                            onExecutionClosed={handleProductionExecutionClosed}
                            onReportConfirmed={handleProductionReportConfirmed}
                            className="min-h-0 flex-1"
                          />
                        ) : null}
                      </form>
                    </CardContent>
                  ) : showOpeningProductionReportGate ? (
                    <CardContent className="space-y-2 px-3 py-4" data-testid="production-report-opening-gate">
                      <ErpPageLoader
                        variant="panel"
                        hint="Opening Production Report…"
                        data-testid="production-report-opening-loader"
                      />
                      <p className="text-center text-[12px] font-medium text-slate-600">
                        Finalizing this batch and preparing the mandatory RM Production Report. Production entry stays
                        locked.
                      </p>
                    </CardContent>
                  ) : (
                    <>
                  {!embedNoQtyRecentEntries ? (
                  <CardHeader className="space-y-0.5 border-b border-slate-100 bg-white px-2.5 py-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Production</CardTitle>
                        <p className="erp-type-helper mt-0 text-[11px] text-slate-500">WO · Item · Qty · Save</p>
                      </div>
                    </div>
                  </CardHeader>
                  ) : null}
                  <CardContent
                    className={cn(
                      "space-y-2 px-3 py-2.5",
                      embedNoQtyRecentEntries &&
                        "flex min-h-0 flex-1 flex-col gap-3 overflow-visible px-3 py-3",
                      showProductionOperatorWorkbench && embedNoQtyRecentEntries && "gap-0 p-0",
                    )}
                  >
                    <form
                      ref={createFormRef}
                      onSubmit={onPost}
                      className={cn("flex flex-col gap-2", embedNoQtyRecentEntries && "min-h-0 flex-1 gap-3")}
                    >
                {!hideScopedProductionEntry ? (
                  <>
                    {navigateNoQtyContext || navigateGreenLevelContext ? (
                      <>
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
                          {workOrdersForProductionSelector.map((w) => (
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
                          {(navigateNoQtyContext ? linesForNoQtyEntryForm : linesForWo).map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.id}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <div className="relative z-0 isolate grid gap-2 lg:grid-cols-2 lg:items-end">
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
                              {`${displayWorkOrderNo(w.id, w.docNo ?? null)} · ${displaySalesOrderNo(w.salesOrderId, w.salesOrderId === focusSoId ? focusSo?.docNo : undefined)}`}
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
                                {l.fgItem.itemName} · balance {fmtProdQty(rem)}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </FieldShortcutHint>
                    </div>
                    )}
                  </>
                ) : null}

                {useGreenLevelWorkbenchLayout && selectedGreenLevelQueueRow && !productionWorkbenchIdentity ? (
                  <GreenLevelProductionCurrentWoCard
                    row={selectedGreenLevelQueueRow}
                    fmtProdQty={fmtProdQty}
                  />
                ) : null}

                {greenLevelDraftApprovalPending ? (
                  <div className="sticky top-0 z-30 shrink-0" data-testid="green-level-draft-approval-strip">
                    {renderDraftProductionBanner({ compact: true })}
                  </div>
                ) : null}

                <div
                  className={cn(
                    useGreenLevelWorkbenchLayout
                      ? cn("grid gap-2", showProductionReport && "xl:grid-cols-2 xl:items-start")
                      : embedNoQtyRecentEntries
                        ? showProductionOperatorWorkbench
                          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                          : "flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
                        : "grid gap-2 lg:min-h-0 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start",
                  )}
                >
                  <div
                    className={cn(
                      "min-w-0 space-y-2 lg:order-2 lg:min-h-0",
                      useGreenLevelWorkbenchLayout && "hidden",
                      embedNoQtyRecentEntries &&
                        "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:order-2",
                      showProductionOperatorWorkbench && embedNoQtyRecentEntries && "hidden",
                    )}
                  >
                    {embedNoQtyRecentEntries && !(showProductionOperatorWorkbench && embedNoQtyRecentEntries) ? (
                      <div data-testid="no-qty-production-work-queue" className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
                        {navigateNoQtyContext ? (
                          <>
                        <ProductionNoQtyWorkQueuePanel
                          rows={noQtyWorkQueueRows.map((row) => ({
                            id: row.id,
                            workOrderId: row.workOrderId,
                            workOrderDocNo: row.workOrderDocNo,
                            cycleNo: row.cycleNo,
                            balance: row.balance,
                            queueStatus: row.queueStatus,
                            qty: Number(row.qty),
                            approvedProducedQty: row.approvedProducedQty,
                            fgItem: row.fgItem,
                          }))}
                          selectedLineId={wolId}
                          onSelect={(row) => {
                            const line = noQtyWorkQueueRows.find((l) => l.id === row.id);
                            if (line) openExecutableProductionLine(line);
                          }}
                          fmtProdQty={fmtProdQty}
                        />
                        {noQtyWaitingRequirementRows.length > 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200/90 bg-slate-50/80 px-3 py-2">
                            <p className="text-[11px] font-semibold text-slate-600">
                              Other RS items (no production this cycle)
                            </p>
                            <ul className="mt-1 space-y-0.5">
                              {noQtyWaitingRequirementRows.map((r) => (
                                <li key={r.key} className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-600">
                                  <span className="truncate font-medium text-slate-700">{r.itemName}</span>
                                  <span className="text-slate-400">·</span>
                                  <span>Waiting for requirement</span>
                                  {r.cycleNo != null ? (
                                    <span className="text-slate-400">· Cycle {r.cycleNo}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                          </>
                        ) : null}
                      </div>
                    ) : (
                    <div className="flex flex-col gap-2">
                      {!navigateGreenLevelContext ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-[12px] font-semibold text-slate-700">Work queue</h3>
                          <span className="text-[11px] text-slate-400">Cycle · WO · Item</span>
                        </div>
                        {noQtyWorkQueueRows.length === 0 ? (
                          <div
                            className="rounded border border-slate-200 bg-slate-50 px-2 py-2 text-[12px] text-slate-700"
                            data-testid="production-workspace-empty"
                          >
                            {hasPendingProductionWork
                              ? "No production required right now for this cycle."
                              : "No production work orders pending."}
                          </div>
                        ) : (
                          <div className="max-h-[min(32vh,280px)] overflow-auto rounded-md border border-slate-200/90 bg-white shadow-sm">
                            <table className="w-full table-fixed text-[11px]">
                              <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                                <tr className="text-left text-[11px] text-slate-600">
                                  <th className="w-12 px-2 py-0.5 font-medium">Cycle</th>
                                  <th className="w-14 px-2 py-0.5 font-medium">WO</th>
                                  <th className="px-2 py-0.5 font-medium">Item</th>
                                  <th className="w-16 px-2 py-0.5 text-right font-medium">Planned</th>
                                  <th className="w-16 px-2 py-0.5 text-right font-medium">Produced</th>
                                  <th className="w-16 px-2 py-0.5 text-right font-medium">Balance</th>
                                  <th className="w-10 px-1 py-0.5 text-right font-medium">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {noQtyWorkQueueRows.map((l) => {
                                  const sel = wolId === l.id;
                                  return (
                                    <tr
                                      key={l.id}
                                      className={cn(
                                        "border-t border-slate-100",
                                        sel && "bg-emerald-50",
                                        l.queueStatus === "qc_pending" && !sel && "bg-amber-50/40",
                                      )}
                                    >
                                      <td className="px-2 py-0.5 tabular-nums font-medium text-slate-800">
                                        {l.cycleNo != null ? l.cycleNo : "—"}
                                      </td>
                                      <td className="px-2 py-0 tabular-nums">
                                {displayWorkOrderNo(l.workOrderId, workOrders.find((w) => w.id === l.workOrderId)?.docNo ?? null)}
                              </td>
                                      <td className="truncate px-2 py-0.5 font-medium" title={l.fgItem.itemName}>
                                        {l.fgItem.itemName}
                                      </td>
                                      <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(Number(l.qty), l.fgItem.unit)}</td>
                                      <td className="px-2 py-0.5 text-right tabular-nums">
                                        {fmtProdQty(l.approvedProducedQty ?? 0, l.fgItem.unit)}
                                      </td>
                                      <td className="px-2 py-0.5 text-right font-semibold tabular-nums">
                                        {fmtProdQty(l.balance, l.fgItem.unit)}
                                      </td>
                                      <td className="px-1 py-0.5 text-right">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 shrink-0 p-0 text-[13px]"
                                          onClick={() => openExecutableProductionLine(l)}
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
                        )}
                        {noQtyWaitingRequirementRows.length > 0 ? (
                          <div className="rounded-md border border-dashed border-slate-200/90 bg-slate-50/80 px-2 py-1.5">
                            <p className="text-[11px] font-semibold text-slate-600">Other RS items (no production this cycle)</p>
                            <ul className="mt-1 space-y-0.5">
                              {noQtyWaitingRequirementRows.map((r) => (
                                <li key={r.key} className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-600">
                                  <span className="truncate font-medium text-slate-700">{r.itemName}</span>
                                  <span className="text-slate-400">·</span>
                                  <span>Waiting for requirement</span>
                                  {r.cycleNo != null ? (
                                    <span className="text-slate-400">· Cycle {r.cycleNo}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {noQtyProductShortageHistoryRows.length > 0 && !embedNoQtyRecentEntries ? (
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h3 className="text-[12px] font-semibold text-slate-700">
                                Product-wise shortage history
                              </h3>
                              <span className="text-[11px] text-slate-400">Latest cycle first</span>
                            </div>
                            <p className="text-[11px] leading-snug text-slate-500">
                              Shortage is carried forward product-wise only when the next RS is created for the same
                              product.
                            </p>
                            <div className="max-h-[min(28vh,220px)] overflow-auto rounded-md border border-slate-200/90 bg-slate-50/80 shadow-sm">
                              <table className="w-full min-w-0 text-[11px]">
                                <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-100/90">
                                  <tr className="text-left text-[11px] text-slate-600">
                                    <th className="px-2 py-0.5 font-medium">Cycle</th>
                                    <th className="px-2 py-0.5 font-medium">Item</th>
                                    <th className="px-2 py-0.5 text-right font-medium">New Requirement</th>
                                    <th className="px-2 py-0.5 text-right font-medium">Last Shortage Added</th>
                                    <th className="px-2 py-0.5 text-right font-medium">Final Planned Qty</th>
                                    <th className="px-2 py-0.5 text-right font-medium">Produced Qty</th>
                                    <th className="px-2 py-0.5 text-right font-medium">Shortage</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {noQtyProductShortageHistoryRows.map((r) => (
                                    <tr
                                      key={r.key}
                                      className={cn(
                                        "border-t border-slate-100",
                                        r.isCurrentCycle && "bg-blue-50/90 ring-1 ring-inset ring-blue-200/80",
                                      )}
                                    >
                                      <td className="px-2 py-0.5 tabular-nums font-semibold text-slate-800">
                                        {r.cycleNo != null ? r.cycleNo : "—"}
                                        {r.isCurrentCycle ? (
                                          <span className="ml-1 rounded bg-blue-100 px-1 py-px text-[10px] font-semibold text-blue-800">
                                            Current
                                          </span>
                                        ) : null}
                                      </td>
                                      <td
                                        className="max-w-[9rem] truncate px-2 py-0.5 font-medium text-slate-900"
                                        title={r.itemName}
                                      >
                                        {r.itemName}
                                      </td>
                                      <td className="px-2 py-0.5 text-right tabular-nums text-slate-700">
                                        {fmtProdQty(r.newRequirement)}
                                      </td>
                                      <td className="px-2 py-0.5 text-right tabular-nums text-slate-700">
                                        {fmtProdQty(r.lastShortageAdded)}
                                      </td>
                                      <td className="px-2 py-0.5 text-right tabular-nums font-medium text-slate-800">
                                        {fmtProdQty(r.finalPlannedQty)}
                                      </td>
                                      <td className="px-2 py-0.5 text-right tabular-nums text-slate-700">
                                        {fmtProdQty(r.producedQty)}
                                      </td>
                                      <td className="px-2 py-0.5 text-right font-semibold tabular-nums text-slate-900">
                                        {fmtProdQty(r.shortageQty)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      ) : null}
                    </div>
                    )}
                  </div>

                  <div
                    className={cn(
                      "min-w-0 space-y-1.5 lg:order-1 lg:min-h-0",
                      embedNoQtyRecentEntries &&
                        "flex min-h-0 flex-1 flex-col gap-2 overflow-visible lg:order-1",
                      showProductionOperatorWorkbench && embedNoQtyRecentEntries && "lg:col-span-2",
                    )}
                  >
                    {showProductionOperatorWorkbench && embedNoQtyRecentEntries ? (
                      renderProductionOperatorWorkbench({
                        alerts:
                          showNoQtyRmStatus && wolId > 0 ? (
                            <ProductionConciseRmStatus
                              workOrderLineId={wolId}
                              refreshKey={liveTick + rmReadinessRefreshTick}
                              initialData={conciseRmInitialData}
                              onLoaded={onRmReadinessLoaded}
                              onLoadingChange={onRmReadinessLoadingChange}
                              workstation
                            />
                          ) : null,
                        entry: (
                          <div className="space-y-1.5 lg:min-h-0">
                            {hideScopedProductionEntry && navigateNoQtyContext ? (
                              <div
                                className="flex min-h-[10rem] flex-col justify-center rounded-md border border-indigo-200 bg-indigo-50/90 px-3 py-3 text-sm text-indigo-950"
                                data-testid={
                                  noQtyPendingShortfallDecision
                                    ? "no-qty-shortfall-decision-hold"
                                    : noQtyPausedShortfallDecision
                                      ? "no-qty-paused-shortfall-hold"
                                      : undefined
                                }
                              >
                                {noQtyPendingShortfallDecision ? (
                                  <>
                                    <div className="text-[14px] font-semibold tracking-tight text-violet-950">
                                      Shortfall decision required
                                    </div>
                                    <p className="mt-2 text-[12px] leading-snug text-slate-700">
                                      Produced qty is below the WO qty. Use Confirm Report &amp; Close WO to carry the
                                      remaining qty forward automatically, or Pause Work Order to continue later.
                                    </p>
                                  </>
                                ) : noQtyPausedShortfallDecision ? (
                                  <>
                                    <div className="text-[14px] font-semibold tracking-tight text-amber-950">
                                      Production paused with remaining qty
                                    </div>
                                    <p className="mt-2 text-[12px] leading-snug text-slate-700">
                                      Resume this WO to restore Continue Production. Final report, RM reconciliation,
                                      wastage, closure and carry-forward are unavailable while paused.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                                      {noQtyNextRsReady ? "Cycle ready for Next RS" : "Production entry completed for this cycle"}
                                    </div>
                                    {productionPrimaryStrip ? (
                                      <p className="mt-2 text-[12px] leading-snug text-slate-600">
                                        Your next action is shown above.
                                      </p>
                                    ) : (
                                      <>
                                        <p className="mt-2 text-[13px] leading-snug text-slate-700">
                                          {noQtyNextRsReady && noQtyCarryForwardQtyFromEngine > 1e-6
                                            ? `Includes previous cycle shortage (${fmtProdQty(noQtyCarryForwardQtyFromEngine)}).`
                                            : "Includes previous cycle shortage when applicable."}
                                        </p>
                                        <p className="mt-1 text-[11px] leading-snug text-slate-600">
                                          {hasPendingProductionWork
                                            ? "The next work order loads automatically when production report is confirmed."
                                            : "No production work orders pending."}
                                        </p>
                                      </>
                                    )}
                                  </>
                                )}
                              </div>
                            ) : navigateGreenLevelContext && hideGreenLevelAddProductionEntry ? (
                              <div
                                className="flex min-h-[10rem] flex-col justify-center rounded-md border border-emerald-200 bg-emerald-50/90 px-3 py-3 text-sm text-emerald-950"
                                data-testid={
                                  noQtyPendingShortfallDecision
                                    ? "green-level-shortfall-decision-hold"
                                    : noQtyPausedShortfallDecision
                                      ? "green-level-paused-shortfall-hold"
                                      : "green-level-production-entry-hold"
                                }
                              >
                                {noQtyPendingShortfallDecision ? (
                                  <>
                                    <div className="text-[14px] font-semibold tracking-tight text-violet-950">
                                      Shortfall decision required
                                    </div>
                                    <p className="mt-2 text-[12px] leading-snug text-slate-700">
                                      Produced qty is below the WO qty. Use Confirm Report &amp; Close WO to finish this
                                      work order, or Pause Work Order to continue later. Remaining qty will be
                                      recalculated in next Green Level planning.
                                    </p>
                                  </>
                                ) : noQtyPausedShortfallDecision ? (
                                  <>
                                    <div className="text-[14px] font-semibold tracking-tight text-amber-950">
                                      Production paused with remaining qty
                                    </div>
                                    <p className="mt-2 text-[12px] leading-snug text-slate-700">
                                      Resume this WO to restore Continue Production. Final report, RM reconciliation,
                                      wastage and closure are unavailable while paused.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                                      Production entry completed for this work order
                                    </div>
                                    <p className="mt-2 text-[12px] leading-snug text-slate-600">
                                      Confirm the production report above to close this Green Level work order.
                                    </p>
                                  </>
                                )}
                              </div>
                            ) : navigateGreenLevelContext && greenLevelShowQcWaiting ? (
                              <div
                                className="flex min-h-[10rem] flex-col justify-center rounded-md border border-amber-200 bg-amber-50/90 px-3 py-3 text-sm text-amber-950"
                                data-testid="green-level-waiting-for-qa"
                              >
                                <div className="text-[14px] font-semibold tracking-tight text-amber-950">
                                  {PRODUCTION_QA_TERMS.WAITING_FOR_QA}
                                </div>
                                <p className="mt-2 text-[12px] leading-snug text-slate-700">
                                  Production is approved for this work order. QA must complete before further production
                                  entry.
                                </p>
                                {canOpenQaFromProduction && selectedGreenLevelQueueRow ? (
                                  <div className="mt-3">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-8 text-[11px] font-semibold"
                                      onClick={() => {
                                        const pendingEntryOnLine = entries.find(
                                          (e) =>
                                            Number(e.workOrderLine?.id ?? 0) ===
                                              Number(selectedGreenLevelQueueRow.workOrderLineId) && qcPendingEntry(e),
                                        );
                                        const prodQs =
                                          pendingEntryOnLine != null
                                            ? `&productionId=${encodeURIComponent(String(pendingEntryOnLine.id))}`
                                            : "";
                                        navigate(
                                          `/qc-entry?workOrderId=${encodeURIComponent(String(selectedGreenLevelQueueRow.workOrderId))}${prodQs}&from=production_screen`,
                                        );
                                      }}
                                    >
                                      View QC
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                            ) : navigateGreenLevelContext && !greenLevelShowProductionEntryForm ? (
                              greenLevelDraftApprovalPending ? null : (
                                <div
                                  className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2 text-sm text-slate-800"
                                  data-testid="green-level-production-readonly"
                                >
                                  {effectiveScopedWolId <= 0 ? (
                                    <>
                                      <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                                        Select a Green Level work order
                                      </div>
                                      <p className="mt-1 text-[12px] leading-snug text-slate-600">
                                        Use Open, Review, or View on a row in the table to continue.
                                      </p>
                                    </>
                                  ) : selectedGreenLevelQueueRow?.action === "review" ? (
                                    <>
                                      <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                                        Draft approval pending
                                      </div>
                                      <p className="mt-1 text-[12px] leading-snug text-slate-600">
                                        Use Review & Finalize on the draft strip above to continue.
                                      </p>
                                    </>
                                  ) : (
                                    <>
                                      <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                                        {selectedGreenLevelQueueRow?.statusLabel ?? "Work order"} — read only
                                      </div>
                                      <p className="mt-1 text-[12px] leading-snug text-slate-600">
                                        This Green Level work order is not open for new production entry. Recent batches
                                        are in the history panel.
                                      </p>
                                    </>
                                  )}
                                </div>
                              )
                            ) : (
                              (() => {
                                if (!selected) {
                                  return (
                                    <div className="space-y-1" data-testid="production-workspace-empty">
                                      <div className="text-[12px] font-semibold tracking-tight text-slate-700">
                                        {navigateGreenLevelContext ? "Green Level production" : "Production queue"}
                                      </div>
                                      <p className="text-[11px] text-slate-500">
                                        {navigateGreenLevelContext
                                          ? "Select a row from the Green Level work order table."
                                          : hasPendingProductionWork
                                            ? "Select a row from the work queue."
                                            : "No production work orders pending."}
                                      </p>
                                    </div>
                                  );
                                }
                                if (rmProductionEntryBlocked) {
                                  return (
                                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-950">
                                      Production entry is blocked until material status is READY.
                                    </p>
                                  );
                                }
                                if (productionQuantityCompleted) {
                                  return renderProductionQuantityCompletedNotice();
                                }
                                const eps = 1e-6;
                                const produced = selected.approvedProducedQty ?? 0;
                                const remCompact = lineRemaining(selected);
                                const qcPendingLine = noQtyQcPendingByWolId.get(selected.id) ?? 0;
                                // Entry QC with remaining balance → continue production (do not dead-end).
                                if (
                                  qcPendingLine > eps &&
                                  remCompact <= eps &&
                                  !suppressDuplicateQcWorkflowUi
                                ) {
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
                                  })}${prodQs}&from=production_screen`;
                                  return (
                                    <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] text-emerald-950">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="text-[11px] font-semibold text-emerald-900/90">Approved</div>
                                          <div className="mt-0.5 grid gap-0.5 text-[11px] text-emerald-950/90">
                                            <div>
                                              Produced:{" "}
                                              <span className="font-semibold tabular-nums text-emerald-950">
                                                {fmtProdQty(produced)}
                                              </span>
                                            </div>
                                            <div>
                                              Status:{" "}
                                              <span className="font-semibold text-emerald-950">
                                                {qcPendingLine > eps
                                                  ? suppressDuplicateQcWorkflowUi
                                                    ? "QC wait"
                                                    : "Pending QC"
                                                  : "QC done / ready"}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                        {canOpenQaFromProduction ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="default"
                                            className="h-8 px-3 text-[11px] font-semibold shadow-sm"
                                            onClick={() => navigate(qcHref)}
                                          >
                                            {PRODUCTION_QA_TERMS.COMPLETE_QA}
                                          </Button>
                                        ) : (
                                          <span className="text-[11px] font-semibold text-emerald-900">
                                            {PRODUCTION_QA_TERMS.WAITING_FOR_QA}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }
                                const hasDraftLocked =
                                  showCompactDraftApprovalStrip &&
                                  latestDraftForSelectedWo != null &&
                                  selected != null &&
                                  Number(latestDraftForSelectedWo.latest.workOrderLine?.workOrder?.id ?? 0) ===
                                    Number(selected.workOrderId) &&
                                  (!navigateGreenLevelContext || greenLevelShowProductionEntryForm);
                                if (hasDraftLocked && !editing) {
                                  return renderDraftProductionBanner({ compact: true });
                                }
                                if (editing && (navigateNoQtyContext || navigateGreenLevelContext)) {
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
                                          <DecimalInput
                                            className={operatorInputClass}
                                            value={editQty}
                                            onValueChange={setEditQty}
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
                                return renderOperatorEntryFields({ saveButtonTitle: noQtyEntryContextLine || undefined });
                              })()
                            )}
                          </div>
                        ),
                        bottomQueue: renderScopedProductionBottomQueue(),
                        afterQueue:
                          useGreenLevelWorkbenchLayout && effectiveScopedWoId > 0 && showProductionReport ? (
                            <ProductionReportPanel
                              key={`gl-inline-report-${effectiveScopedWoId}`}
                              workOrderId={effectiveScopedWoId}
                              refreshKey={liveTick}
                              enableDraftCache
                              compact
                              premium
                              className="min-h-0"
                              closeWorkOrderOnConfirm
                              confirmButtonLabel="Confirm Report & Close WO"
                              onConfirmed={handleProductionReportConfirmed}
                            />
                          ) : null,
                      })
                    ) : (
                    <div className={cn("space-y-1.5 lg:min-h-0", embedNoQtyRecentEntries && "space-y-0")}>
                      {hideScopedProductionEntry && navigateNoQtyContext ? (
                        <div
                          className="flex min-h-[10rem] flex-col justify-center rounded-md border border-indigo-200 bg-indigo-50/90 px-3 py-3 text-sm text-indigo-950"
                          data-testid={
                            noQtyPendingShortfallDecision
                              ? "no-qty-shortfall-decision-hold"
                              : noQtyPausedShortfallDecision
                                ? "no-qty-paused-shortfall-hold"
                                : undefined
                          }
                        >
                          {noQtyPendingShortfallDecision ? (
                            <>
                              <div className="text-[14px] font-semibold tracking-tight text-violet-950">
                                Shortfall decision required
                              </div>
                              <p className="mt-2 text-[12px] leading-snug text-slate-700">
                                Produced qty is below the WO qty. Use Confirm Report &amp; Close WO to carry the remaining
                                qty forward automatically, or Pause Work Order to continue later.
                              </p>
                            </>
                          ) : noQtyPausedShortfallDecision ? (
                            <>
                              <div className="text-[14px] font-semibold tracking-tight text-amber-950">
                                Production paused with remaining qty
                              </div>
                              <p className="mt-2 text-[12px] leading-snug text-slate-700">
                                Resume this WO to restore Continue Production. Final report, RM reconciliation, wastage,
                                closure and carry-forward are unavailable while paused.
                              </p>
                            </>
                          ) : (
                            <>
                          <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                            {noQtyNextRsReady ? "Cycle ready for Next RS" : "Production entry completed for this cycle"}
                          </div>
                          {productionPrimaryStrip ? (
                            <p className="mt-2 text-[12px] leading-snug text-slate-600">Your next action is shown above.</p>
                          ) : (
                            <>
                              <p className="mt-2 text-[13px] leading-snug text-slate-700">
                                {noQtyNextRsReady && noQtyCarryForwardQtyFromEngine > 1e-6
                                  ? `Includes previous cycle shortage (${fmtProdQty(noQtyCarryForwardQtyFromEngine)}).`
                                  : "Includes previous cycle shortage when applicable."}
                              </p>
                              <p className="mt-1 text-[11px] leading-snug text-slate-600">
                                {hasPendingProductionWork
                                  ? "The next work order loads automatically when production report is confirmed."
                                  : "No production work orders pending."}
                              </p>
                            </>
                          )}
                            </>
                          )}
                        </div>
                      ) : navigateGreenLevelContext && hideGreenLevelAddProductionEntry ? (
                        <div
                          className="flex min-h-[10rem] flex-col justify-center rounded-md border border-emerald-200 bg-emerald-50/90 px-3 py-3 text-sm text-emerald-950"
                          data-testid={
                            noQtyPendingShortfallDecision
                              ? "green-level-shortfall-decision-hold"
                              : noQtyPausedShortfallDecision
                                ? "green-level-paused-shortfall-hold"
                                : "green-level-production-entry-hold"
                          }
                        >
                          {noQtyPendingShortfallDecision ? (
                            <>
                              <div className="text-[14px] font-semibold tracking-tight text-violet-950">
                                Shortfall decision required
                              </div>
                              <p className="mt-2 text-[12px] leading-snug text-slate-700">
                                Produced qty is below the WO qty. Use Confirm Report &amp; Close WO to finish this work
                                order, or Pause Work Order to continue later. Remaining qty will be recalculated in next
                                Green Level planning.
                              </p>
                            </>
                          ) : noQtyPausedShortfallDecision ? (
                            <>
                              <div className="text-[14px] font-semibold tracking-tight text-amber-950">
                                Production paused with remaining qty
                              </div>
                              <p className="mt-2 text-[12px] leading-snug text-slate-700">
                                Resume this WO to restore Continue Production. Final report, RM reconciliation, wastage
                                and closure are unavailable while paused.
                              </p>
                            </>
                          ) : (
                            <>
                              <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                                Production entry completed for this work order
                              </div>
                              <p className="mt-2 text-[12px] leading-snug text-slate-600">
                                Confirm the production report above to close this Green Level work order.
                              </p>
                            </>
                          )}
                        </div>
                      ) : navigateGreenLevelContext && greenLevelShowQcWaiting ? (
                        <div
                          className="flex min-h-[10rem] flex-col justify-center rounded-md border border-amber-200 bg-amber-50/90 px-3 py-3 text-sm text-amber-950"
                          data-testid="green-level-waiting-for-qa"
                        >
                          <div className="text-[14px] font-semibold tracking-tight text-amber-950">
                            {PRODUCTION_QA_TERMS.WAITING_FOR_QA}
                          </div>
                          <p className="mt-2 text-[12px] leading-snug text-slate-700">
                            Production is approved for this work order. QA must complete before further production entry.
                          </p>
                          {canOpenQaFromProduction && selectedGreenLevelQueueRow ? (
                            <div className="mt-3">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 text-[11px] font-semibold"
                                onClick={() => {
                                  const pendingEntryOnLine = entries.find(
                                    (e) =>
                                      Number(e.workOrderLine?.id ?? 0) ===
                                        Number(selectedGreenLevelQueueRow.workOrderLineId) && qcPendingEntry(e),
                                  );
                                  const prodQs =
                                    pendingEntryOnLine != null
                                      ? `&productionId=${encodeURIComponent(String(pendingEntryOnLine.id))}`
                                      : "";
                                  navigate(
                                    `/qc-entry?workOrderId=${encodeURIComponent(String(selectedGreenLevelQueueRow.workOrderId))}${prodQs}&from=production_screen`,
                                  );
                                }}
                              >
                                View QC
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : navigateGreenLevelContext && !greenLevelShowProductionEntryForm ? (
                        greenLevelDraftApprovalPending ? null : (
                        <div
                          className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2 text-sm text-slate-800"
                          data-testid="green-level-production-readonly"
                        >
                          {effectiveScopedWolId <= 0 ? (
                            <>
                              <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                                Select a Green Level work order
                              </div>
                              <p className="mt-1 text-[12px] leading-snug text-slate-600">
                                Use Open, Review, or View on a row in the table to continue.
                              </p>
                            </>
                          ) : selectedGreenLevelQueueRow?.action === "review" ? (
                            <>
                              <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                                Draft approval pending
                              </div>
                              <p className="mt-1 text-[12px] leading-snug text-slate-600">
                                Use Review & Finalize on the draft strip above to continue.
                              </p>
                            </>
                          ) : (
                            <>
                              <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                                {selectedGreenLevelQueueRow?.statusLabel ?? "Work order"} — read only
                              </div>
                              <p className="mt-1 text-[12px] leading-snug text-slate-600">
                                This Green Level work order is not open for new production entry. Recent batches are in
                                the history panel.
                              </p>
                            </>
                          )}
                        </div>
                        )
                      ) : (
                        <div
                          className={cn(
                            embedNoQtyRecentEntries &&
                              "grid gap-1.5 lg:grid-cols-[minmax(0,1fr)_minmax(10rem,13rem)] lg:items-start",
                          )}
                        >
                        <ProductionNoQtyLoggingActionConsole
                          enabled={embedNoQtyRecentEntries}
                          className="relative z-10 min-w-0"
                        >
                        <div className={cn(embedNoQtyRecentEntries ? "space-y-2" : "space-y-2")}>
                      {showNoQtyRmStatus && wolId > 0 ? (
                        <ProductionConciseRmStatus
                          workOrderLineId={wolId}
                          refreshKey={liveTick + rmReadinessRefreshTick}
                          initialData={conciseRmInitialData}
                          onLoaded={onRmReadinessLoaded}
                          onLoadingChange={onRmReadinessLoadingChange}
                          workstation={embedNoQtyRecentEntries}
                        />
                      ) : null}
                      {!embedNoQtyRecentEntries
                        ? (() => {
                        if (!selected) {
                          return (
                            <div className="space-y-1" data-testid="production-workspace-empty">
                              <div className="text-[12px] font-semibold tracking-tight text-slate-700">
                                {navigateGreenLevelContext ? "Green Level production" : "Production queue"}
                              </div>
                              <p className="text-[11px] text-slate-500">
                                {navigateGreenLevelContext
                                  ? "Select a row from the Green Level work order table."
                                  : hasPendingProductionWork
                                    ? "Select a row from the work queue."
                                    : "No production work orders pending."}
                              </p>
                            </div>
                          );
                        }
                        if (rmProductionEntryBlocked) {
                          return (
                            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-950">
                              Production entry is blocked until material status is READY.
                            </p>
                          );
                        }
                        if (productionQuantityCompleted) {
                          return renderProductionQuantityCompletedNotice();
                        }
                        const eps = 1e-6;
                        const rem = lineRemaining(selected);
                        const produced = selected.approvedProducedQty ?? 0;
                        const qcPendingLine = noQtyQcPendingByWolId.get(selected.id) ?? 0;
                        // Entry QC alone must not hide Continue when remaining quantity is executable.
                        if (qcPendingLine > eps && rem <= eps && !suppressDuplicateQcWorkflowUi) {
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
                          })}${prodQs}&from=production_screen`;
                          return (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-[12px] text-emerald-950">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold text-emerald-900/90">
                                    Approved · ready for QC
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-emerald-900/90">
                                    QC pending:{" "}
                                    <span className="font-semibold tabular-nums text-emerald-950">
                                      {fmtProdQty(qcPendingLine)}
                                    </span>
                                  </div>
                                </div>
                                {canOpenQaFromProduction ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="default"
                                    className="h-8 px-3 text-[11px] font-semibold shadow-sm"
                                    onClick={() => navigate(qcHref)}
                                  >
                                    {PRODUCTION_QA_TERMS.COMPLETE_QA}
                                  </Button>
                                ) : (
                                  <span className="text-[11px] font-semibold text-emerald-900">
                                    {PRODUCTION_QA_TERMS.WAITING_FOR_QA}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        }
                        const noQtyCarryForwardIdle =
                          navigateNoQtyContext &&
                          isCarryForwardLine(selected, "NO_QTY") &&
                          !noQtyAllowShopFloorContinue;
                        const needsNextActionChoice =
                          produced > eps &&
                          rem > eps &&
                          noQtyHasApprovedByWolId.has(selected.id) &&
                          !noQtyCarryForwardIdle;
                        const entrySectionTitle = noQtyShowContinueProductionCta
                          ? "Continue Production"
                          : "Log production";
                        if (!needsNextActionChoice || noQtyAllowShopFloorContinue) {
                          return productionOperatorHeaderCompressed ? null : (
                            <div className="space-y-1">
                              <div className="text-[12px] font-semibold tracking-tight text-slate-700">
                                {entrySectionTitle}
                              </div>
                              {noQtyEntryContextLine ? (
                                <p className="text-[11px] leading-snug text-slate-600">{noQtyEntryContextLine}</p>
                              ) : null}
                            </div>
                          );
                        }

                        const cycleIdNav = effectiveNoQtyCycleId ?? null;
                        const qcSoId = noQtyWorkbenchSoId > 0 ? noQtyWorkbenchSoId : focusSoId;
                        const qcHref = `${buildNoQtyGuidedHref({
                          to: "/qc-entry",
                          salesOrderId: qcSoId,
                          cycleId: cycleIdNav,
                          fromStep: "production",
                        })}&from=production_screen`;

                        if (suppressDuplicateQcWorkflowUi) {
                          return productionOperatorHeaderCompressed ? null : (
                            <div className="space-y-1">
                              <div className="text-[12px] font-semibold tracking-tight text-slate-700">
                                {noQtyShowContinueProductionCta ? "Continue Production" : "Log production"}
                              </div>
                              {noQtyEntryContextLine ? (
                                <p className="text-[11px] leading-snug text-slate-600">{noQtyEntryContextLine}</p>
                              ) : null}
                            </div>
                          );
                        }

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
                              {canOpenQaFromProduction ? (
                                <Button type="button" size="sm" variant="default" className="font-semibold shadow-sm" onClick={() => navigate(qcHref)}>
                                  Move to QC
                                </Button>
                              ) : (
                                <span className="text-[11px] font-semibold text-slate-700">
                                  {PRODUCTION_QA_TERMS.WAITING_FOR_QA}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                        })()
                        : null}
                      {selected && !navigateNoQtyContext && !productionOperatorIdentityProps ? (
                        <p className="text-[11px] text-slate-600">
                          <span className="font-medium text-slate-800">{selected.fgItem.itemName}</span>
                          <span className="text-slate-400"> · </span>
                          <span className="font-medium text-slate-700">
                            {displaySalesOrderNo(selected.salesOrderId, focusSo?.docNo)}
                          </span>
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
                          !noQtyAllowShopFloorContinue;
                        const needsDecisionForm =
                          produced > eps && rem > eps && noQtyHasApprovedByWolId.has(selected.id);
                        if ((needsDecisionForm || noQtyCfBlockForm) && !noQtyAllowShopFloorContinue) return null;
                        const approvedOnLine = navigateNoQtyContext && noQtyHasApprovedByWolId.has(selected.id);
                        const remainingUi = selectedMetrics?.remainingQty ?? rem;
                        const noRemaining = Number.isFinite(Number(remainingUi)) && Number(remainingUi) <= eps;
                        if (approvedOnLine && noRemaining && !editing && !(suppressDuplicateQcWorkflowUi && qcPendingLine > eps)) {
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
                          })}${prodQs}&from=production_screen`;
                          return (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] text-emerald-950">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold text-emerald-900/90">
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
                                        {qcPendingLine > eps
                                          ? suppressDuplicateQcWorkflowUi
                                            ? "QC wait"
                                            : "Pending QC"
                                          : "QC done / ready"}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                {canOpenQaFromProduction ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="default"
                                    className="h-8 px-3 text-[11px] font-semibold shadow-sm"
                                    onClick={() => navigate(qcHref)}
                                  >
                                    {PRODUCTION_QA_TERMS.COMPLETE_QA}
                                  </Button>
                                ) : (
                                  <span className="text-[11px] font-semibold text-emerald-900">
                                    {PRODUCTION_QA_TERMS.WAITING_FOR_QA}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        }
                        const hasDraftLocked =
                          showCompactDraftApprovalStrip &&
                          latestDraftForSelectedWo != null &&
                          selected != null &&
                          Number(latestDraftForSelectedWo.latest.workOrderLine?.workOrder?.id ?? 0) ===
                            Number(selected.workOrderId) &&
                          (!navigateGreenLevelContext || greenLevelShowProductionEntryForm);
                        if (hasDraftLocked && !editing) {
                          return embedNoQtyRecentEntries ? (
                            <div className="relative z-20">{renderDraftProductionBanner({ compact: true })}</div>
                          ) : (
                            <div className="space-y-2">
                              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                                Draft saved. Review the draft and proceed.
                              </div>
                              <div>{renderDraftProductionBanner({ compact: false })}</div>
                            </div>
                          );
                        }
                        if (editing && (navigateNoQtyContext || navigateGreenLevelContext)) {
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
                                  <DecimalInput
                                    className={operatorInputClass}
                                    value={editQty}
                                    onValueChange={setEditQty}
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
                            <ProductionOperatorEntryShell>
                              {productionQuantityCompleted
                                ? renderProductionQuantityCompletedNotice()
                                : renderOperatorEntryFields({ saveButtonTitle: noQtyEntryContextLine || undefined })}
                            </ProductionOperatorEntryShell>
                            {noQtyEntryContextLine && !embedNoQtyRecentEntries && !productionQuantityCompleted ? (
                              <p className="text-[10px] leading-snug text-slate-500">{noQtyEntryContextLine}</p>
                            ) : null}
                          </>
                        );
                      })()}
                        </div>
                        </ProductionNoQtyLoggingActionConsole>
                        {embedNoQtyRecentEntries ? (
                          <div className="min-w-0 lg:sticky lg:top-1">
                            {renderRecentEntriesPanel(true, { operatorWorkbench: true, containedScroll: true })}
                          </div>
                        ) : null}
                        </div>
                      )}
                    </div>
                    )}
                  </div>

                  {useGreenLevelWorkbenchLayout &&
                  effectiveScopedWoId > 0 &&
                  showProductionReport &&
                  !(showProductionOperatorWorkbench && embedNoQtyRecentEntries) ? (
                    <div className="min-w-0 xl:sticky xl:top-2 xl:max-h-[min(72vh,calc(100dvh-12rem))] xl:overflow-auto">
                      <ProductionReportPanel
                        key={`gl-inline-report-${effectiveScopedWoId}`}
                        workOrderId={effectiveScopedWoId}
                        refreshKey={liveTick}
                        enableDraftCache
                        compact
                        premium
                        className="min-h-0"
                        closeWorkOrderOnConfirm
                        confirmButtonLabel="Confirm Report & Close WO"
                        onConfirmed={handleProductionReportConfirmed}
                      />
                    </div>
                  ) : null}
                </div>

                {useGreenLevelWorkbenchLayout && !(showProductionOperatorWorkbench && embedNoQtyRecentEntries) ? (
                  <div className="grid gap-3 border-t border-slate-200/90 pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:items-start">
                    <GreenLevelProductionWorkQueuePanel
                      variant="secondary"
                      containedScroll={!useProductionPageNaturalScroll}
                      rows={greenLevelOtherQueueRows}
                      selectedLineId={effectiveScopedWolId}
                      onRowAction={requestGreenLevelRowSwitch}
                      fmtProdQty={fmtProdQty}
                    />
                    <div className="min-w-0">{renderRecentEntriesPanel(true, { operatorWorkbench: true })}</div>
                  </div>
                ) : null}

                </form>
                  </CardContent>
                    </>
                  )}
                </Card>
              </>
            )}

          </div>
      ) : !canProd ? (
        <p className="text-[13px] text-slate-600">Production / Admin only.</p>
      ) : !initialRefreshDone ? (
        <ErpPageLoader variant="workspace" hint="Loading production workspace…" />
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
              {getRoleEmptyState("production_queue", roleUi.role).title}{" "}
              {getRoleEmptyState("production_queue", roleUi.role).body ?? ""}
            </p>
          ) : null}
        </>
      ) : (
        <form ref={createFormRef} onSubmit={onPost} className="flex min-h-0 flex-col">
          {!fromNoQtySo ? (
            showProductionOperatorWorkbench ? (
              renderProductionOperatorWorkbench({
                alerts: (
                  <>
                    {isRegularFlow && regularSoCoverage ? (
                      <RegularSoEndProductionPanel
                        coverage={regularSoCoverage}
                        unit={selected?.fgItem?.unit}
                        busy={regularEndProductionBusy}
                        onEndCovered={() => void handleRegularEndProduction("END_COVERED")}
                        onEndShortage={() => void handleRegularEndProduction("END_SHORTAGE")}
                        onContinueLater={() => returnToProductionWorkspaceDashboard({ refreshAfter: true })}
                      />
                    ) : null}
                    {effectiveScopedWoId > 0 ? (
                      <ProductionRunStartConfirmPanel
                        workOrderId={effectiveScopedWoId}
                        fgItemId={selected?.fgItemId ?? null}
                        canConfirm={canConfirmProductionStart}
                        selectedRunAllocationId={selectedRunAllocationId}
                        onSelectedRunAllocationIdChange={setSelectedRunAllocationId}
                        onEntryGateChange={onRunStartEntryGateChange}
                        onChanged={() => void refresh()}
                        preferredRunAllocationId={
                          Number.isFinite(runAllocationIdFromUrl) && runAllocationIdFromUrl > 0
                            ? runAllocationIdFromUrl
                            : null
                        }
                        autoOpenConfirm={autoOpenConfirmStart}
                      />
                    ) : null}
                    {showRegularRmReadiness && !draftApprovalPendingRegular ? (
                      <ProductionConciseRmStatus
                        workOrderLineId={wolId}
                        refreshKey={liveTick + rmReadinessRefreshTick}
                        initialData={conciseRmInitialData}
                        onLoaded={onRmReadinessLoaded}
                        onLoadingChange={onRmReadinessLoadingChange}
                        className={productionPrimaryStripCoversMaterialCard ? "sr-only" : undefined}
                      />
                    ) : null}
                  </>
                ),
                entry: regularCreateFormLockedByDraft ? (
                  <p
                    className="rounded border border-amber-300 bg-amber-50 px-2 py-2 text-[12px] text-amber-950"
                    data-testid="regular-draft-owns-create-form"
                  >
                    Draft already exists. Approve, edit, or cancel the draft to continue.
                  </p>
                ) : showRegularProductionEntry ? (
                  renderOperatorEntryFields()
                ) : productionQuantityCompleted ? (
                  renderProductionQuantityCompletedNotice()
                ) : regularSoCoverage?.reportPending ? (
                  <p className="text-[12px] text-amber-900" data-testid="regular-entry-locked-report-pending">
                    Production entry locked while Production Report is pending.
                  </p>
                ) : regularSoCoverage?.soDemandCovered ? (
                  <p className="text-[12px] text-emerald-950" data-testid="regular-entry-locked-so-covered">
                    SO demand is covered. Use End Production &amp; Continue to Report — further production entry is not
                    allowed.
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-600">Waiting for RM readiness…</p>
                ),
                afterQueue:
                  showProductionReport && !navigateGreenLevelContext ? (
                    <ProductionReportPanel
                      key={scopedProductionWorkspaceKey(effectiveScopedWoId, effectiveScopedWolId)}
                      workOrderId={effectiveScopedWoId}
                      refreshKey={liveTick}
                      enableDraftCache
                      confirmButtonLabel={
                        regularSoCoverage?.reportPending || regularSoCoverage?.soDemandCovered
                          ? "Confirm Report & Close WO"
                          : undefined
                      }
                      onConfirmed={handleProductionReportConfirmed}
                    />
                  ) : null,
              })
            ) : null
          ) : showProductionOperatorWorkbench ? (
              renderProductionOperatorWorkbench({
                entry: productionQuantityCompleted
                  ? renderProductionQuantityCompletedNotice()
                  : renderOperatorEntryFields(),
              })
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
                            : `${displayWorkOrderNo(w.id, w.docNo ?? null)} · ${displaySalesOrderNo(w.salesOrderId, w.salesOrderId === focusSoId ? focusSo?.docNo : undefined)}`}
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
                {fromNoQtySo && selected && selectedMetrics && !productionOperatorIdentityProps ? (
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
                      <h3 className="text-[12px] font-semibold text-slate-600">
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
                                  <td className="px-2 py-0 tabular-nums">
                                {displayWorkOrderNo(l.workOrderId, workOrders.find((w) => w.id === l.workOrderId)?.docNo ?? null)}
                              </td>
                                )}
                                <td className="max-w-[11rem] truncate px-2 py-0.5 font-medium" title={l.fgItem.itemName}>
                                  {l.fgItem.itemName}
                                </td>
                                <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(Number(l.qty), l.fgItem.unit)}</td>
                                <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(approved, l.fgItem.unit)}</td>
                                <td className="px-2 py-0.5 text-right font-semibold tabular-nums">{fmtProdQty(rem, l.fgItem.unit)}</td>
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

                <div className="min-w-0 rounded-md border border-slate-200 bg-white p-2 shadow-sm">
                  <ProductionOperatorEntryShell className="border-0 p-0 shadow-none">
                  <div className="space-y-2">
                    {!productionOperatorIdentityProps ? (
                    <div className="text-[12px] font-semibold tracking-tight text-slate-700">
                      {navigateNoQtyContext && noQtyShowContinueProductionCta
                        ? "Continue Production"
                        : "Log production"}
                    </div>
                    ) : null}
                    {fromNoQtySo && selected && !productionOperatorIdentityProps ? (
                      <p className="text-[12px] text-slate-600">
                        <span className="font-medium text-slate-800">{selected.fgItem.itemName}</span>
                        <span className="text-slate-400"> · </span>
                        <span className="font-medium text-slate-700">
                          {displaySalesOrderNo(focusSoIdValid ? focusSoId : selected.salesOrderId, focusSo?.docNo)}
                        </span>
                        <span className="text-slate-400"> · </span>
                        <span className="font-medium text-slate-700">
                                Cycle {noQtyCycleNoForDisplay != null ? `#${noQtyCycleNoForDisplay}` : "—"}
                        </span>
                      </p>
                    ) : null}
                    {selectedMetrics && !productionOperatorIdentityProps ? (
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
                    {productionQuantityCompleted
                      ? renderProductionQuantityCompletedNotice()
                      : renderOperatorEntryFields()}
                  </div>
                  </ProductionOperatorEntryShell>
                </div>
              </div>
            </>
          )}
        </form>
      )}

      {!placeDraftInHardenedPrimaryCard &&
      !placeDraftAfterRegularProductionCard &&
      !productionPrimaryStripCoversDraft &&
      !greenLevelDraftApprovalPending &&
      !(fromNoQtySo && !showNoQtyScopedProductionCard && flatLines.length > 0 && canProd) ? (
        <div className="mb-1.5">{renderDraftProductionBanner({ compact: true })}</div>
      ) : null}

      {showProductionReport && !showProductionWorkspaceCompactLayout && !navigateGreenLevelContext && !showProductionOperatorWorkbench ? (
        <ProductionReportPanel
          key={scopedProductionWorkspaceKey(effectiveScopedWoId, effectiveScopedWolId)}
          workOrderId={effectiveScopedWoId}
          refreshKey={liveTick}
          enableDraftCache
          className={cn(!fromNoQtySo && flatLines.length > 0 && "mt-1")}
          onConfirmed={handleProductionReportConfirmed}
        />
      ) : null}

      {!embedNoQtyRecentEntries && !showProductionWorkspace && !useGreenLevelWorkbenchLayout && !showProductionOperatorWorkbench
        ? renderRecentEntriesPanel(false)
        : null}

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
                  <DecimalInput
                    className={operatorInputClass}
                    value={editQty}
                    onValueChange={setEditQty}
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

      {reverseModalEntry && isAdmin ? (
        <ErpModal onClose={closeReverseModal} closeOnBackdropClick aria-labelledby="prod-admin-reverse-title">
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
                        const unit =
                          reverseModalEntry.workOrderLine?.fgItem?.unit ?? selected?.fgItem?.unit ?? null;
                        setReverseQtyDraft(sanitizeProductionQtyDraftInput(e.target.value, unit));
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
        </ErpModal>
      ) : null}
    </OperatorPageBody>
  );

  /** REGULAR approve modal — must render on every branch (REGULAR early returns omitted it previously). */
  const rmConsumptionApproveModal = (
    <ProductionRmConsumptionReviewModal
      open={consumptionApproveId != null && !navigateGreenLevelContext}
      productionEntryId={consumptionApproveId}
      onClose={closeConsumptionApproveModal}
      onPreviewSettled={onConsumptionPreviewSettled}
      approvalExtras={consumptionApprovalExtras}
      onApproved={(res) => {
        const extrasSnapshot = consumptionApprovalExtras;
        setConsumptionApproveId((openId) => {
          if (openId != null) {
            const approvedRow = entries.find((e) => e.id === openId);
            setRowBusy(openId);
            void afterProductionApproveSuccess(
              openId,
              approvedRow,
              res.consumptionWarnings,
              extrasSnapshot,
              res.remainingDispositionResult as
                | { outcome?: string; summary?: ProductionExecutionSummary | null }
                | null
                | undefined,
            ).finally(() => setRowBusy(null));
          }
          return null;
        });
      }}
    />
  );

  const reviewFinalize = reviewFinalizeEntryId != null ? draftFinalizationReview(reviewFinalizeEntryId) : null;
  const reviewFinalizeModal = reviewFinalize ? (
    <ErpModal onClose={() => setReviewFinalizeEntryId(null)} aria-labelledby="review-finalize-title">
      <div className="w-full max-w-3xl space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <div>
          <h2 id="review-finalize-title" className="text-xl font-semibold text-slate-900">Review &amp; Finalize</h2>
          <p className="mt-1 text-sm text-slate-600">
            {isRegularFlow
              ? "Finalizing confirms this output and sends it to QC. After approval, choose Continue Later or End Production with Shortage."
              : "Finalizing confirms this output and sends it to QC. Choose what happens to the remaining WO balance."}
          </p>
        </div>
        <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-3">
          <div><span className="text-slate-500">WO planned</span><div className="font-semibold">{fmtProdQty(reviewFinalize.planned)}</div></div>
          <div><span className="text-slate-500">Previously finalized</span><div className="font-semibold">{fmtProdQty(reviewFinalize.previouslyFinalized)}</div></div>
          <div><span className="text-slate-500">Current draft</span><div className="font-semibold">{fmtProdQty(reviewFinalize.currentDraft)}</div></div>
          <div><span className="text-slate-500">Total after entry</span><div className="font-semibold">{fmtProdQty(reviewFinalize.totalAfter)}</div></div>
          <div><span className="text-slate-500">WO quantity balance</span><div className="font-semibold text-amber-800">{fmtProdQty(reviewFinalize.remaining)}</div></div>
          <div><span className="text-slate-500">UOM</span><div className="font-semibold">{reviewFinalize.row.workOrderLine?.fgItem?.unit || "—"}</div></div>
          <div><span className="text-slate-500">RM-supported production max</span><div className="font-semibold">{rmEntryQtyCap != null ? fmtProdQty(rmEntryQtyCap) : "Validated at finalization"}</div></div>
          <div><span className="text-slate-500">Unused RM-supported capacity</span><div className="font-semibold">{rmEntryQtyCap != null ? fmtProdQty(Math.max(0, Number(rmEntryQtyCap) - reviewFinalize.totalAfter)) : "—"}</div></div>
          <div><span className="text-slate-500">Approved tolerance</span><div className="font-semibold">WO plan + 5% where applicable</div></div>
        </div>
        {!isRegularFlow && reviewFinalize.remaining > 1e-6 ? (
          <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Remaining work order disposition">
            {REVIEW_FINALIZE_REMAINING_OPTIONS.map(({ id, title, description }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={reviewDisposition === id}
                onClick={() => setReviewDisposition(id)}
                className={cn(
                  "min-h-32 rounded-lg border-2 p-4 text-left transition",
                  reviewDisposition === id
                    ? "border-emerald-600 bg-emerald-50"
                    : "border-slate-200 bg-white hover:border-slate-400",
                )}
              >
                <span className="block text-base font-semibold text-slate-900">{title}</span>
                <span className="mt-2 block text-sm leading-relaxed text-slate-600">{description}</span>
              </button>
            ))}
          </div>
        ) : isRegularFlow ? (
          <div
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"
            data-testid="regular-review-finalize-next-decision"
          >
            Approve this recorded quantity once. The next decision contains only Continue Later or End Production with
            Shortage; RM return, runner, and wastage remain in the Production Report.
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-medium">Complete Production — Production Report is still required.</p>
            <p className="text-amber-900/90">
              Finalizing confirms this batch and sends it to QC. It does <span className="font-semibold">not</span> close the
              work order. Unused RM-supported capacity is not wastage until you allocate material in the Production Report
              (return to Store and/or documented wastage). Close only via Confirm Report &amp; Close WO when unexplained RM
              balance is zero.
            </p>
          </div>
        )}
        {!isRegularFlow && reviewFinalize.remaining > 1e-6 && reviewDisposition === "PAUSE" ? (
          <label className="block text-sm font-medium text-slate-700">Pause reason
            <select className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={reviewPauseReason} onChange={(e) => setReviewPauseReason(e.target.value)}>
              <option value="MACHINE_BREAKDOWN">Machine Breakdown</option><option value="WAITING_FOR_RM">Waiting for RM</option><option value="TOOL_MOULD_MAINTENANCE">Tool / Mould Maintenance</option><option value="QUALITY_CONCERN">Quality Concern</option><option value="POWER_UTILITY_FAILURE">Power / Utility Failure</option><option value="MANAGEMENT_HOLD">Management Hold</option><option value="OTHER">Other</option>
            </select>
          </label>
        ) : null}
        {!isRegularFlow && reviewFinalize.remaining > 1e-6 && reviewDisposition === "END_WITH_SHORTAGE" ? (
          (() => {
            const shortageFlow: ReviewFinalizeFlowKind =
              productionFlowMode === "NO_QTY"
                ? "NO_QTY"
                : productionFlowMode === "GREEN_LEVEL"
                  ? "GREEN_LEVEL"
                  : "OTHER";
            const shortageCopy = reviewFinalizeShortagePanelCopy({
              flow: shortageFlow,
              shortageQty: reviewFinalize.remaining,
              formatQty: fmtProdQty,
              unit: reviewFinalize.row.workOrderLine?.fgItem?.unit || "Nos",
            });
            return (
              <div
                className="space-y-2 rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm text-red-950"
                data-testid={shortageCopy.testId}
              >
                <p className="font-semibold">{shortageCopy.heading}</p>
                <p>{shortageCopy.body}</p>
                <label className="flex items-start gap-2 font-medium">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={reviewPermanentClosureAcknowledged}
                    onChange={(event) => setReviewPermanentClosureAcknowledged(event.target.checked)}
                  />
                  <span>{shortageCopy.checkbox}</span>
                </label>
              </div>
            );
          })()
        ) : null}
        <label className="block text-sm font-medium text-slate-700">
          {!isRegularFlow && reviewDisposition === "END_WITH_SHORTAGE" ? "Closure reason (required)" : "Remarks (optional)"}
          <textarea className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={2} value={reviewRemarks} onChange={(e) => setReviewRemarks(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setReviewFinalizeEntryId(null)}>Back to Draft</Button>
          <Button
            type="button"
            variant={reviewDisposition === "END_WITH_SHORTAGE" ? "destructive" : "default"}
            disabled={
              (!isRegularFlow && !isReviewFinalizeDispositionReady({
                remainingAfterEntry: reviewFinalize.remaining,
                disposition: reviewDisposition,
              })) ||
              (!isRegularFlow && reviewDisposition === "END_WITH_SHORTAGE" &&
                (!reviewRemarks.trim() || !reviewPermanentClosureAcknowledged))
            }
            onClick={() => {
            const id = reviewFinalizeEntryId;
            if (
              !isRegularFlow &&
              !isReviewFinalizeDispositionReady({
                remainingAfterEntry: reviewFinalize.remaining,
                disposition: reviewDisposition,
              })
            ) {
              return;
            }
            const closeDecision = !isRegularFlow && isProductionReportCloseDecision({
              remainingAfterEntry: reviewFinalize.remaining,
              disposition: reviewDisposition,
            });
            const woForReport = Number(
              reviewFinalize.row.workOrderLine?.workOrder?.id ?? effectiveScopedWoId ?? 0,
            );
            // Gate BEFORE modal close / API — no Continue/runner frame.
            if (closeDecision && woForReport > 0) {
              setProductionReportTransitionWoId(woForReport);
            }
            setReviewFinalizeEntryId(null);
            if (id != null) {
              executeDraftFinalization(
                id,
                !isRegularFlow && reviewFinalize.remaining > 1e-6 && reviewDisposition
                  ? {
                      remainingDisposition: reviewDisposition,
                      pauseReason: reviewDisposition === "PAUSE" ? reviewPauseReason : undefined,
                      dispositionRemarks: reviewRemarks.trim() || null,
                    }
                  : { dispositionRemarks: reviewRemarks.trim() || null },
              );
            }
          }}>
            {!isRegularFlow && reviewDisposition === "END_WITH_SHORTAGE"
              ? reviewFinalizeShortagePanelCopy({
                  flow:
                    productionFlowMode === "NO_QTY"
                      ? "NO_QTY"
                      : productionFlowMode === "GREEN_LEVEL"
                        ? "GREEN_LEVEL"
                        : "OTHER",
                  shortageQty: reviewFinalize.remaining,
                  formatQty: fmtProdQty,
                  unit: reviewFinalize.row.workOrderLine?.fgItem?.unit || "Nos",
                }).button
              : reviewFinalizePrimaryButtonLabel({
                  remainingAfterEntry: reviewFinalize.remaining,
                  disposition: reviewDisposition,
                })}
          </Button>
        </div>
      </div>
    </ErpModal>
  ) : null;

  /**
   * Active shift-run deep link (Confirm Machine Start / Record Production).
   * Never render a blank page — loading, error, or confirm shell until WO line workbench mounts.
   */
  if (activeShiftDeepLinkLoadState === "loading") {
    return (
      <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-2 pb-2">
        <ErpPageLoader
          variant="workspace"
          hint="Loading active shift run…"
          data-testid="active-shift-run-deep-link-loading"
        />
        {shiftSessionIdFromUrl > 0 ? (
          <p className="text-center text-[12px] text-slate-600">
            <Link className="font-medium text-teal-800 underline" to={activeShiftBackHref}>
              Back to Active Shift
            </Link>
          </p>
        ) : null}
      </PageContainer>
    );
  }

  if (activeShiftDeepLinkLoadState === "wo_missing") {
    return (
      <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-3 pb-2" data-testid="active-shift-run-deep-link-error">
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950" role="alert">
          Work order {displayWorkOrderNo(woIdFromUrlPick, null)} is not available in Production Workspace.
          {error ? ` ${error}` : ""}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={activeShiftBackHref} className={buttonVariants({ variant: "outline" })}>
            Back to Active Shift
          </Link>
          <Button type="button" variant="secondary" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (showActiveShiftRunConfirmShell) {
    return (
      <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-2 pb-2" data-testid="active-shift-run-confirm-shell">
        <OperationalContextSticky className="sticky top-0 z-20 space-y-1 border-b border-slate-200/90 bg-white/95 pb-1.5 pt-0.5 shadow-sm backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PageSmartBackLink defaultTo={activeShiftBackHref} defaultLabel="Back to Active Shift" />
            <h1 className="text-sm font-semibold tracking-tight text-slate-900">Production Workspace</h1>
          </div>
        </OperationalContextSticky>
        {activeShiftContextStrip}
        <ProductionRunStartConfirmPanel
          workOrderId={effectiveScopedWoId}
          fgItemId={selected?.fgItemId ?? null}
          canConfirm={canConfirmProductionStart}
          selectedRunAllocationId={selectedRunAllocationId}
          onSelectedRunAllocationIdChange={setSelectedRunAllocationId}
          onEntryGateChange={onRunStartEntryGateChange}
          onChanged={() => void refresh()}
          preferredRunAllocationId={
            Number.isFinite(runAllocationIdFromUrl) && runAllocationIdFromUrl > 0
              ? runAllocationIdFromUrl
              : null
          }
          autoOpenConfirm={autoOpenConfirmStart}
        />
        {activeShiftWorkspaceCue === ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION ? (
          <p className="text-[12px] text-slate-600" data-testid="active-shift-record-production-hint">
            After start confirmation, record production quantities here or use the full entry form once the work order
            line loads.
          </p>
        ) : null}
      </PageContainer>
    );
  }

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
        <ErpPageLoader variant="panel" hint="Resolving production context…" data-testid="production-identity-resolving" />
      </PageContainer>
    );
  }

  // Full-page gate while End/Equal/Extra finalize settles — never paint Continue / runner chrome.
  if (showOpeningProductionReportGate && useHardenedProductionShell) {
    return (
      <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-2 pb-2">
        <ErpPageLoader
          variant="workspace"
          hint="Opening Production Report…"
          data-testid="production-report-opening-page"
        />
        <p className="text-center text-[12px] font-medium text-slate-600">
          Finalizing this batch and preparing the mandatory RM Production Report.
        </p>
        {rmConsumptionApproveModal}
        {reviewFinalizeModal}
      </PageContainer>
    );
  }

  if (!useHardenedProductionShell) {
    if (showProductionWorkspace) {
      return (
        <PageContainer className="erp-flow-page -mt-1 flex max-w-none flex-col space-y-1.5">
          <OperationalContextSticky className="sticky top-0 z-20 space-y-1 border-b border-slate-200/90 bg-white/95 pb-1.5 pt-0.5 shadow-sm backdrop-blur-sm">
            <DemoFlowBanner />
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <PageSmartBackLink
                  defaultTo={fromPendingActions ? "/pending-actions" : "/dashboard"}
                  defaultLabel={fromPendingActions ? "Back to Pending Actions" : "Back to Dashboard"}
                />
                <h1 className="text-sm font-semibold leading-tight tracking-tight text-slate-900">Production Workspace</h1>
                <p className="text-[11px] leading-snug text-slate-600">
                  Active shop-floor work across REGULAR, NO_QTY, and Green Level.
                </p>
              </div>
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
          </OperationalContextSticky>
          {main}
          {rmConsumptionApproveModal}
          {reviewFinalizeModal}
        </PageContainer>
      );
    }

    /** REGULAR Report Mode — dedicated compact workbench; hide entry / RM / recent / Other Open WOs. */
    if (
      isRegularFlow &&
      showProductionWorkspaceCompactLayout &&
      productionWorkspaceWoSummary &&
      effectiveScopedWoId > 0
    ) {
      return (
        <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-1.5 pb-2" data-testid="regular-production-report-mode">
          <OperationalContextSticky className="sticky top-0 z-20 space-y-1 border-b border-slate-200/90 bg-white/95 pb-1 pt-0.5 shadow-sm backdrop-blur-sm">
            <DemoFlowBanner />
            <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
              <PageSmartBackLink defaultTo="/work-orders" defaultLabel="Back to Work Orders" />
              <h1 className="text-sm font-semibold tracking-tight text-slate-900">Production Report</h1>
            </div>
          </OperationalContextSticky>
          <ProductionWorkspaceCompactPanel
            key={scopedProductionWorkspaceKey(effectiveScopedWoId, effectiveScopedWolId)}
            workOrderId={effectiveScopedWoId}
            orderType="REGULAR"
            woSummary={productionWorkspaceWoSummary}
            canOperate={canProd}
            executionRefreshKey={executionPanelRefreshTick}
            reportRefreshKey={liveTick}
            evaluateTick={completionEvaluateTick}
            evaluateBatchQty={completionEvaluateBatchQty}
            onChanged={() => {
              void refresh();
            }}
            onSummaryChange={handleScopedWoExecutionSummaryChange}
            onExecutionClosed={async ({ workOrderId }) => {
              const woRow = workOrders.find((w) => w.id === workOrderId);
              const woLabel = displayWorkOrderNo(workOrderId, woRow?.docNo ?? null);
              toast.showSuccess(`Production report confirmed — ${woLabel} closed.`);
              returnToProductionWorkspaceDashboard({ refreshAfter: true });
            }}
            onReportConfirmed={handleProductionReportConfirmed}
            className="min-h-0"
          />
          {rmConsumptionApproveModal}
          {reviewFinalizeModal}
        </PageContainer>
      );
    }
    return (
      <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-1.5">
        {kbHelpOpen && canProd ? (
          <ErpModal onClose={() => setKbHelpOpen(false)} aria-label="Keyboard shortcuts">
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
          </ErpModal>
        ) : null}
        <OperationalContextSticky className="sticky top-0 z-20 space-y-1 border-b border-slate-200/90 bg-white/95 pb-1.5 pt-0.5 shadow-sm backdrop-blur-sm">
          <DemoFlowBanner />
          {!productionOperatorHeaderCompressed ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {productionRegularBackNav ? (
                <ERPBackNavigation
                  to={productionRegularBackNav.to}
                  label={productionRegularBackNav.label}
                  replace
                  disabled={backToWorkspaceBusy}
                  data-testid="production-back-to-workspace"
                  onNavigate={(target) => navigateBackToProductionWorkspaceList(target.to)}
                />
              ) : (
                <PageSmartBackLink defaultTo="/work-orders" defaultLabel="Back to Work Orders" />
              )}
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
          </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {productionRegularBackNav ? (
                <ERPBackNavigation
                  to={productionRegularBackNav.to}
                  label={productionRegularBackNav.label}
                  replace
                  disabled={backToWorkspaceBusy}
                  data-testid="production-back-to-workspace"
                  onNavigate={(target) => navigateBackToProductionWorkspaceList(target.to)}
                />
              ) : (
                <PageSmartBackLink defaultTo="/work-orders" defaultLabel="Back to Work Orders" />
              )}
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
          )}
          {flowMismatchMessage ? (
            <div
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-950"
              role="alert"
              data-testid="production-flow-mismatch"
            >
              {flowMismatchMessage}
            </div>
          ) : null}
          {!productionOperatorHeaderCompressed ? (
            isRegularFlow && selected && Number(selected.salesOrderId) > 0 ? (
            <ProductionFlowIdentityBar
              flow={PRODUCTION_FLOW_REGULAR}
              soLabel={displaySalesOrderNo(
                selected.salesOrderId,
                selected.salesOrderId === focusSoId ? focusSo?.docNo ?? null : null,
              )}
              woLabel={
                woId > 0
                  ? displayWorkOrderNo(woId, activeWoForRegularShell?.docNo ?? null)
                  : displayWorkOrderNo(selected.workOrderId, null)
              }
              itemName={selected.fgItem.itemName}
            />
          ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            <span className="rounded bg-slate-900 px-1.5 py-0.5 text-white">Regular Sales Order</span>
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
          )
          ) : null}
          {!productionOperatorHeaderCompressed && selected && Number(selected.salesOrderId) > 0 ? (
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
              {regularQcBannerHref && !showTopQcNextStrip && selectedWoQcPending && canOpenQaFromProduction ? (
                /*
                 * Breadcrumb "Open QC" link. Hidden when the page-level top QC strip already
                 * exposes the same action — keeps a single canonical QC CTA per screen state.
                 */
                <Link className="text-sky-900 underline-offset-2 hover:underline" to={regularQcBannerHref}>
                  {PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA}
                </Link>
              ) : null}
            </div>
          ) : null}
          {!productionOperatorHeaderCompressed && (navigateNoQtyContext || showProductionWorkspace) ? (
            !(isRegularFlow && selected && Number(selected.salesOrderId) > 0) ? (
          <OperationalContextBar className="rounded-md border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-2 py-1 shadow-sm">
            <span className="font-semibold text-slate-600">SO</span>
            <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-sky-900">
              {(() => {
                const soId =
                  selected?.salesOrderId ??
                  productionStickyContext?.salesOrderId ??
                  0;
                if (!(soId > 0)) return "—";
                const soDoc =
                  selected && selected.salesOrderId === focusSoId
                    ? focusSo?.docNo
                    : productionStickyContext?.soDocNo ?? (soId === focusSoId ? focusSo?.docNo : null);
                return displaySalesOrderNo(soId, soDoc);
              })()}
            </span>
            <OpCtxSep />
            <span className="font-semibold text-slate-600">WO</span>
            <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-900">
              {(() => {
                const id =
                  effectiveScopedWoId > 0
                    ? effectiveScopedWoId
                    : selected?.workOrderId ??
                      productionStickyContext?.workOrderId ??
                      activeWoForRegularShell?.id ??
                      0;
                if (!(id > 0)) return "—";
                const woDoc =
                  activeWoForRegularShell?.id === id
                    ? activeWoForRegularShell?.docNo
                    : productionStickyContext?.woDocNo ??
                      workOrders.find((w) => w.id === id)?.docNo ??
                      null;
                return displayWorkOrderNo(id, woDoc);
              })()}
            </span>
            <OpCtxSep />
            <span className="text-slate-500">Item</span>
            <span className="max-w-[12rem] truncate font-semibold text-slate-900">
              {selected?.fgItem.itemName ?? productionStickyContext?.itemName ?? "—"}
            </span>
            <OpCtxSep />
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Status
            </span>
            <span className="font-semibold text-slate-900">{regularWorkflowStageLabel}</span>
            {displayHeaderMetrics && (selected || productionStickyContext) ? (
              <>
                <OpCtxSep />
                <span className="text-slate-500">Planned</span>
                <span className="font-bold tabular-nums text-slate-900">{fmtProdQty(displayHeaderMetrics.woLineQty)}</span>
                <OpCtxSep />
                <span className="text-slate-500">Produced</span>
                <span className="font-bold tabular-nums text-slate-900">{fmtProdQty(displayHeaderMetrics.usedQty)}</span>
                <OpCtxSep />
                <span className="text-emerald-800">Remaining</span>
                <span className="font-bold tabular-nums text-emerald-950">{fmtProdQty(displayHeaderMetrics.remainingQty)}</span>
              </>
            ) : null}
          </OperationalContextBar>
            ) : null
          ) : null}
        </OperationalContextSticky>
        {main}
        {rmConsumptionApproveModal}
        {reviewFinalizeModal}
      </PageContainer>
    );
  }
    return (
      <PageContainer
        className={cn(
          "erp-flow-page -mt-1 max-w-none",
          noQtyPremiumViewport ? "flex min-h-0 flex-1 flex-col overflow-hidden space-y-1" : "space-y-2",
        )}
      >
      {kbHelpOpen && canProd ? (
        <ErpModal onClose={() => setKbHelpOpen(false)} aria-label="Keyboard shortcuts">
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
        </ErpModal>
      ) : null}
      <OperationalContextSticky className={cn(noQtyPremiumViewport && "shrink-0 py-0")}>
        {showNoQtyOperatorChrome ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <ERPBackNavigation
                kind="production"
                workOrderId={effectiveScopedWoId > 0 ? effectiveScopedWoId : undefined}
                className="shrink-0"
                data-testid={
                  showProductionWorkspaceCompactLayout
                    ? "production-compact-back-nav"
                    : "production-logging-back-nav"
                }
              />
              {canProd && embedNoQtyRecentEntries ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setKbHelpOpen(true)}
                >
                  ? Keys
                </Button>
              ) : null}
            </div>
            {hardenedWoSummary && !showProductionOperatorWorkbench ? (
              <div className="mt-1">
                <ProductionNoQtyOperatorContextBar
                  summary={hardenedWoSummary}
                  flowLabel={productionOperatorFlowLabel}
                  flowContextLabel={productionOperatorFlowContextLabel}
                  statusLabel={productionOperatorStatusLabel}
                  unit={selected?.fgItem?.unit ?? null}
                />
              </div>
            ) : null}
          </>
        ) : null}
        {!showNoQtyOperatorChrome && !showProductionWorkspaceCompactLayout && navigateNoQtyContext ? (
          <PageNoQtyFlowBackLink step="PRODUCTION" />
        ) : null}
        {flowMismatchMessage ? (
          <div
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-950"
            role="alert"
            data-testid="production-flow-mismatch"
          >
            {flowMismatchMessage}
          </div>
        ) : null}
        {!showNoQtyOperatorChrome && !showProductionWorkspaceCompactLayout ? (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            {!productionWorkbenchIdentity && !showProductionWorkspace ? (
              <>
                <h1 className="text-sm font-semibold leading-tight tracking-tight text-slate-900">Production</h1>
                <p className="text-[11px] leading-snug text-slate-600">Record output and track progress.</p>
              </>
            ) : null}
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
        ) : null}
        {!showNoQtyOperatorChrome && showNoQtyScopedProductionCard && noQtyWorkbenchSoId > 0 && !showProductionWorkspaceCompactLayout ? (
          <>
            <ProductionFlowIdentityBar
              compact
              flow={PRODUCTION_FLOW_NO_QTY}
              soLabel={displaySalesOrderNo(noQtyWorkbenchSoId, focusSo?.docNo ?? null)}
              cycleNo={noQtyCycleNoForDisplay}
              rsLabel={
                selectedWoForNoQtyChrome?.requirementSheetId != null &&
                Number(selectedWoForNoQtyChrome.requirementSheetId) > 0
                  ? displayRequirementSheetNo(Number(selectedWoForNoQtyChrome.requirementSheetId), null)
                  : null
              }
              woLabel={
                effectiveScopedWoId > 0
                  ? displayWorkOrderNo(effectiveScopedWoId, selectedWoForNoQtyChrome?.docNo ?? null)
                  : null
              }
              itemName={selected?.fgItem.itemName ?? null}
            />
            {!productionOperatorIdentityProps ? (
            <NoQtyMacroLifecycleStrip
              flow={noQtyFlowState}
              rmLabel={conciseRmLabel}
              cycleNo={noQtyCycleNoForDisplay}
            />
            ) : null}
          </>
        ) : !showNoQtyOperatorChrome && showNoQtyScopedProductionCard && !showProductionWorkspaceCompactLayout ? (
          !productionOperatorIdentityProps ? (
          <OperationalContextBar className="rounded-md border border-slate-200/90 bg-gradient-to-r from-slate-50 to-white px-2.5 py-1.5 text-[11px] text-slate-800 shadow-sm">
            <span className="font-mono font-semibold tabular-nums text-slate-900">
              {displaySalesOrderNo(noQtyWorkbenchSoId, focusSo?.docNo ?? null)}
            </span>
            <OpCtxSep />
            <span>
              Cycle{" "}
              <span className="font-bold tabular-nums text-slate-950">
                {noQtyCycleNoForDisplay != null ? noQtyCycleNoForDisplay : "—"}
              </span>
            </span>
            <OpCtxSep />
            <span>
              RS{" "}
              <span className="font-mono font-semibold tabular-nums text-violet-950">
                {selectedWoForNoQtyChrome?.requirementSheetId != null &&
                Number(selectedWoForNoQtyChrome.requirementSheetId) > 0
                  ? displayRequirementSheetNo(Number(selectedWoForNoQtyChrome.requirementSheetId), null)
                  : "—"}
              </span>
            </span>
            <OpCtxSep />
            <span className="font-mono font-semibold tabular-nums">
              {effectiveScopedWoId > 0
                ? displayWorkOrderNo(effectiveScopedWoId, selectedWoForNoQtyChrome?.docNo ?? null)
                : "—"}
            </span>
            <OpCtxSep />
            <span className="max-w-[10rem] truncate font-semibold text-slate-900" title={selected?.fgItem.itemName ?? ""}>
              {selected?.fgItem.itemName ?? "—"}
            </span>
            {selectedMetrics ? (
              <>
                <OpCtxSep />
                <span>
                  Planned <span className="font-bold tabular-nums">{fmtProdQty(selectedMetrics.woLineQty)}</span>
                </span>
                <OpCtxSep />
                <span>
                  Produced <span className="font-bold tabular-nums">{fmtProdQty(selectedMetrics.usedQty)}</span>
                </span>
                {noQtyDisplayOperatorPendingQty != null ? (
                  <>
                    <OpCtxSep />
                    <span className="text-amber-900">
                      Remaining qty{" "}
                      <span className="font-bold tabular-nums text-amber-950">
                        {fmtProdQty(noQtyDisplayOperatorPendingQty)}
                      </span>
                    </span>
                  </>
                ) : null}
              </>
            ) : null}
            {noQtyCycleDisplayStatus ? (
              <>
                <OpCtxSep />
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Status
                </span>
                <span className="font-semibold text-slate-900">{noQtyCycleDisplayStatus.label}</span>
              </>
            ) : null}
          </OperationalContextBar>
          ) : null
        ) : !showNoQtyOperatorChrome && showGreenLevelScopedProductionCard && !showProductionWorkspaceCompactLayout ? (
          <ProductionFlowIdentityBar
            flow={PRODUCTION_FLOW_GREEN_LEVEL}
            soLabel={GREEN_LEVEL_STOCK_SOURCE_LABEL}
            woLabel={
              effectiveScopedWoId > 0
                ? displayWorkOrderNo(effectiveScopedWoId, selectedWoForNoQtyChrome?.docNo ?? null)
                : null
            }
            itemName={selected?.fgItem.itemName ?? null}
          />
        ) : !showNoQtyOperatorChrome && navigateNoQtyContext && focusSoIdValid && !showProductionWorkspaceCompactLayout ? (
          <NoQtyCycleContextBar
            compact
            soId={focusSoId}
            soDocNo={focusSo?.docNo ?? null}
            customerName={focusSo?.customerName ?? null}
            cycleNo={noQtyCycleNoForDisplay}
            itemName={selected?.fgItem.itemName ?? null}
            operatorPendingQty={noQtyDisplayOperatorPendingQty}
            erpAdjustedPlanningQty={noQtyErpAdjustedPlanningQty}
            totalToProduceQty={selectedMetrics?.woLineQty ?? null}
            qcPassedQty={selectedMetrics?.usedQty ?? null}
          />
        ) : !showNoQtyOperatorChrome ? (
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
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-800 ring-1 ring-slate-200">
              PRODUCTION
            </span>
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
          </OperationalContextBar>
        ) : null}
        {!showNoQtyOperatorChrome && navigateNoQtyContext && focusSoIdValid && noQtyCycleDisplayStatus && !showProductionWorkspaceCompactLayout ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200/90 bg-white px-2.5 py-1 text-[11px] text-slate-800 shadow-sm">
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Cycle status
            </span>
            <span className="font-semibold text-slate-900">{noQtyCycleDisplayStatus.label}</span>
          </div>
        ) : null}
        {!showNoQtyOperatorChrome && useHardenedProductionShell && effectiveScopedWoId > 0 && canProd && !showProductionWorkspaceCompactLayout ? (
          <>
            <ProductionRunStartConfirmPanel
              workOrderId={effectiveScopedWoId}
              fgItemId={selected?.fgItemId ?? null}
              canConfirm={canConfirmProductionStart}
              selectedRunAllocationId={selectedRunAllocationId}
              onSelectedRunAllocationIdChange={setSelectedRunAllocationId}
              onEntryGateChange={onRunStartEntryGateChange}
              className="mb-2"
              onChanged={() => void refresh()}
              preferredRunAllocationId={
                Number.isFinite(runAllocationIdFromUrl) && runAllocationIdFromUrl > 0
                  ? runAllocationIdFromUrl
                  : null
              }
              autoOpenConfirm={autoOpenConfirmStart}
            />
            <ProductionExecutionPanel
              key={scopedProductionWorkspaceKey(effectiveScopedWoId, effectiveScopedWolId)}
              workOrderId={effectiveScopedWoId}
              orderType={isGreenLevelFlow ? "GREEN_LEVEL" : "NO_QTY"}
              canOperate={canProd}
              refreshKey={executionPanelRefreshTick}
              evaluateTick={completionEvaluateTick}
              evaluateBatchQty={completionEvaluateBatchQty}
              workOrderLabel={hardenedWoSummary?.woLabel}
              itemName={hardenedWoSummary?.itemName}
              unit={selected?.fgItem?.unit ?? null}
              onChanged={() => {
                void refresh();
              }}
              onSummaryChange={handleScopedWoExecutionSummaryChange}
              onExecutionClosed={handleProductionExecutionClosed}
            />
          </>
        ) : null}
      </OperationalContextSticky>
      {/*
       * Phase 1: "Create Next RS" CTA removed from the Production page.
       * NO_QTY Next RS ownership now lives only on Dashboard, NO_QTY SO detail and Requirement Sheet pages.
       */}
      <div
        className={cn(
          usePremiumViewport && !useProductionPageNaturalScroll && "flex min-h-0 flex-1 flex-col overflow-hidden",
        )}
      >
        {main}
      </div>
      {rmConsumptionApproveModal}
      {reviewFinalizeModal}
      <GreenLevelProductionWoSwitchDialog
        open={glWoSwitchPrompt != null}
        woLabel={glWoSwitchPrompt?.fromWoLabel ?? "Work order"}
        onCancel={() => setGlWoSwitchPrompt(null)}
        onDiscard={() => {
          if (!glWoSwitchPrompt) return;
          clearProductionReportDraft(effectiveScopedWoId);
          onGreenLevelQueueRowAction(glWoSwitchPrompt.targetRow);
          setGlWoSwitchPrompt(null);
        }}
        onKeepDraft={() => {
          if (!glWoSwitchPrompt) return;
          onGreenLevelQueueRowAction(glWoSwitchPrompt.targetRow);
          setGlWoSwitchPrompt(null);
        }}
      />
    </PageContainer>
  );
}
