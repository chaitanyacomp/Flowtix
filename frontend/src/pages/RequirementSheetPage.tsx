/**
 * NO_QTY FLOW ONLY
 *
 * Flow:
 * NO_QTY SO
 * → Requirement Sheet
 * → Cycle Planning
 * → Production
 * → QC
 * → Dispatch
 * → Continue Planning
 *
 * This flow is:
 * - cycle based
 * - planning driven
 * - shortage carry-forward based
 *
 * DO NOT IMPORT:
 * - Regular WO preparation screens (`RmCheckPage`, `/work-orders/prepare`)
 * - fixed-order dispatch assumptions
 * - REGULAR RM check shortage math into RS lines
 *
 * (Requirement sheet authoring per cycle — not REGULAR fixed-qty RM check / WO prep.)
 */
import * as React from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { workOrdersFocusHref } from "../lib/drillDownRoutes";
import { formatPostWoCreateSuccessMessage, postWoMaterialIssueHref } from "../lib/materialWorkflowLinks";
import { ensureSubmittedPmrForWorkOrderHandoff } from "../lib/postWoMaterialIssueHandoff";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { apiFetch, ApiRequestError } from "../services/api";
import { PageContainer, ERPBackNavigation, PageNoQtyFlowBackLink } from "../components/PageHeader";
import { NoQtyCycleContextBar } from "../components/erp/foundation/NoQtyCycleContextBar";
import { ErpWorkflowBanner } from "../components/erp/foundation/ErpWorkflowBanner";
import { ErpPageLoader } from "../components/erp/foundation/ErpPageLoader";
import { ErpWorkflowTrail } from "../components/erp/foundation/ErpWorkflowTrail";
import { useStoreExecutionNavContext } from "../hooks/useStoreExecutionNavContext";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { readNoQtySoCreatedBannerState, type NoQtySoCreatedBannerState } from "../lib/noQtySoCreatedNavState";
import {
  OperationalContextBar,
  OperationalContextSticky,
  OpCtxSep,
} from "../components/erp/OperationalWorkspaceChrome";
import { CircleHelp } from "lucide-react";
import { displaySalesOrderNo, displayRequirementSheetNo } from "../lib/docNoDisplay";
import { ActivityHistoryCard } from "../components/ActivityHistoryCard";
import { NoQtyMacroLifecycleStrip } from "../components/erp/production/NoQtyMacroLifecycleStrip";
import { NoQtyNextRsStatusPanel } from "../components/erp/production/NoQtyNextRsStatusPanel";
import { NoQtyRsCycleSummaryPanel } from "../components/erp/production/NoQtyRsCycleSummaryPanel";
import { RequirementSheetExecutionPanel } from "../components/erp/production/RequirementSheetExecutionPanel";
import { ExecutionWorkspaceContextHeader } from "../components/erp/production/ExecutionWorkspaceContextHeader";
import { ProductionFlowTypeBadge } from "../components/erp/production/ProductionFlowTypeBadge";
import { PRODUCTION_FLOW_NO_QTY } from "../lib/productionFlowContract";
import {
  useNoQtyFlowState,
} from "../lib/noQtyFlowState";
import { prepareNoQtyNextRequirementSheetAndNavigate } from "../lib/noQtyPrepareNextRsNavigate";
import {
  noQtyCurrentCycleLabel,
  noQtyNextCycleLabel,
} from "../lib/noQtyRsActionLabels";
import {
  loadNoQtyRsCycleSummaries,
  totalAllCyclesQty,
  totalPreviousCyclesQty,
  type NoQtyRsCycleSummaryEntry,
} from "../lib/noQtyRsCycleSummary";
import { useToast } from "../contexts/ToastContext";
import { cn } from "../lib/utils";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { useCanCreateNextRs, useCanOpenRequirementSheet } from "../hooks/useIsAdmin";
import { RS_WRITE_ROLES } from "../config/erpRoles";
import { useAuth } from "../hooks/useAuth";
import { noQtyAgreementListHref, isStoreLikePlanningRole } from "../lib/noQtyStoreNavigation";
import {
  isDecisionOnlyRecoveryCycleReady,
  DECISION_ONLY_RECOVERY_FINALIZE_MESSAGE,
} from "../lib/noQtyDecisionOnlyRecoveryCycle";
import { resolveNoQtyPostRsLockNavigation } from "../lib/noQtyPostRsLockNavigation";
import type { NoQtyFlowState } from "../lib/noQtyFlowState";
import {
  isExecutionModeRequested,
  resolveExecutionViewCycleId,
  resolveExplicitExecutionSheetId,
  shouldHonorExplicitRsExecutionIdentity,
  shouldRenderNoQtyExecutionWorkspace,
  shouldUseNoQtyExecutionModeShell,
  resolveRequirementSheetWorkbenchPageTitle,
  WO_PLANNING_UX,
} from "../lib/requirementSheetExecutionWorkspaceUx";
import { resolveRequirementSheetFlowStateCycleId } from "../lib/requirementSheetFlowCycle";
import {
  WorkbenchShell,
  WorkbenchMain,
  WorkbenchAlerts,
  WorkbenchHeader,
  WorkbenchKpiStrip,
  WorkbenchActionCluster,
  WorkbenchInfoPanels,
} from "../components/erp/workbench";
import { RequirementSheetNoQtyGrid } from "../components/erp/requirementSheet/RequirementSheetNoQtyGrid";
import {
  buildRequirementSheetKpiItems,
  resolveRequirementSheetWorkbenchActions,
} from "../lib/requirementSheetWorkbenchPresentation";
import { computeLiveNetProductionRequirement } from "../lib/requirementSheetNoQtyUx";

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

type SheetStatus = "DRAFT" | "LOCKED" | "CANCELLED";

type SheetListRow = {
  id: number;
  periodKey?: string | null;
  version?: number | null;
  status: SheetStatus;
  /** NO_QTY: which SalesOrderCycle this sheet belongs to; versioning is per cycle. */
  cycleId?: number | null;
  /** NO_QTY: cycle number for display (from list API). */
  cycleNo?: number | null;
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
  /** Item UOM from Requirement Sheet API (`item.unit`); same field used by RequirementSheetNoQtyGrid. */
  unit?: string | null;
  // Backend still returns requirementQty for compatibility (treated as New requirement Qty).
  requirementQty: string;
  // New fields for NO_QTY shortfall workflow.
  shortfallQty?: number | null;
  productionShortfallQty?: number | null;
  qcRejectionRecoveryQty?: number | null;
  baseDemandQty?: number | null;
  approvedManualAdjustmentQty?: number | null;
  totalRsQty?: number | null;
  qcStockNote?: string | null;
  newWoQty?: string;
  totalWoQty?: number | null;
  availableStockQty?: number | null;
  /** NO_QTY: total physical USABLE (global bucket; floored at 0); see freeSurplusUsableQty for dispatch-context surplus */
  totalUsableQty?: number | null;
  /** NO_QTY: usable reserved for pending cycle dispatch (FIFO; includes closed cycles until confirmed dispatch meets commitment) */
  reservedForActiveNoQtyDispatchQty?: number | null;
  /** NO_QTY: usable surplus FG available for optional dispatch (informational; not deducted from Total to Produce). */
  freeSurplusUsableQty?: number | null;
  /** NO_QTY LOCKED-only legacy fields; null in DRAFT (see totalUsableQty / reservedForActive / freeSurplusUsableQty) */
  usableTotalQty?: number | null;
  /** NO_QTY draft clarity: pending-dispatch reserve demand for this SO+item */
  reservedPendingDispatchQty?: number | null;
  /** NO_QTY draft clarity: how much of the reserve is actually blocking this SO's usable stock (min(usableTotal, reserveDemand)) */
  reservedPendingDispatchAppliedQty?: number | null;
  /** NO_QTY: FG qty approved to USABLE after a prior cycle closed (informational for dispatch / QC context). */
  postCycleApprovalQty?: number | null;
  /** NO_QTY: FG qty from previous cycle still in hold/rework/recheck disposition (not yet USABLE). */
  pendingQcDispositionQty?: number | null;
  /** NO_QTY: first-pass production QC still pending (produced − accepted − rejected). */
  productionQcPendingQty?: number | null;
  /** NO_QTY: QC-accepted (+ recheck/post) from prior cycle still not operationally dispatched — informational for dispatch context. */
  previousCycleUndispatchedAcceptedQty?: number | null;
  /** NO_QTY: WO over-production still awaiting QC (not Prior Accepted Excess). */
  producedExcessPendingQcQty?: number | null;
  acceptedWoExcessQty?: number | null;
  provisionalNetRecoveryQty?: number | null;
  provisionalNetRecoverySubjectToQc?: boolean | null;
  provisionalNetRecoveryExplanation?: string | null;
  producedExcessPendingQcBlocksFinalize?: boolean | null;
  producedExcessPendingQcFinalizeMessage?: string | null;
  carriedQcAcceptedExcessCreditQty?: number | null;
  unappliedQcAcceptedExcessCreditQty?: number | null;
  gapPercent?: number | null;
  suggestedWoQty?: number | null;
  /** Cycle production need (gross fulfillment − usable stock); drives WO / dispatch cap. */
  productionRequiredQty?: number | null;
  priorAcceptedQty?: number | null;
  priorAcceptedExcessQty?: number | null;
  unusedAcceptedExcessQty?: number | null;
  availableAcceptedSurplusQty?: number | null;
  netProductionRequirementQty?: number | null;
  acceptedExcessExplanation?: string | null;
  fulfillmentQty?: number | null;
  coveredFromStockQty?: number | null;
  yellowThreshold?: number | null;
  greenThreshold?: number | null;
  colorZone?: "GREEN" | "YELLOW" | "RED" | "EXCESS" | null;
};

type LockHandoff = {
  workOrderCreated?: boolean;
  workOrderId?: number | null;
  workOrderDocNo?: string | null;
  productionMaterialRequest?: {
    id: number;
    docNo?: string | null;
    status?: string | null;
    createdThisLock?: boolean;
  } | null;
  executionStartsAt?: "MONTHLY_PLAN_RELEASE" | "DECISION_ONLY_RECOVERY" | null;
};

type SheetDetail = {
  id: number;
  docNo?: string | null;
  salesOrderId: number;
  cycleId?: number | null;
  /** Present on lock response when zero-fulfillment recovery cycle closed without production. */
  decisionOnlyRecoveryCycle?: boolean;
  decisionOnlyCycleClosed?: boolean;
  status: SheetStatus;
  periodKey?: string | null;
  version?: number | null;
  /** Legacy compatibility: first linked WO only. NO_QTY multi-WO consumers should use workOrders. */
  workOrderId?: number | null;
  workOrderIds?: number[];
  workOrders?: Array<{
    id: number;
    docNo?: string | null;
    status?: string | null;
    createdAt?: string | null;
    pmrId?: number | null;
    pmrDocNo?: string | null;
    pmrStatus?: string | null;
  }>;
  productionMaterialRequestId?: number | null;
  pmrDocNo?: string | null;
  pmrStatus?: string | null;
  lockHandoff?: LockHandoff | null;
  sourceReference?: string | null;
  remarks?: string | null;
  customerName?: string | null;
  lines: SheetLine[];
  availableQcRecovery?: Array<{
    recoverySourceId: number;
    itemId: number;
    itemName?: string | null;
    uom?: string | null;
    availableQty: number;
    sourceQty?: number;
    recoveryStatus?: string;
    sourceWorkOrderId?: number | null;
  }>;
  recoverySummary?: {
    salesOrderId: number;
    totals: {
      productionShortfallSourceQty?: number;
      productionShortfallAvailableQty?: number;
      qcFinalRejectionSourceQty?: number;
      qcFinalRejectionAvailableQty?: number;
      waivedQty?: number;
      activeAllocatedQty?: number;
    };
    sources: Array<{
      recoverySourceId: number;
      itemId: number;
      itemName?: string | null;
      uom?: string | null;
      recoveryType: string;
      recoveryStatus: string;
      sourceQty: number;
      waivedQty: number;
      activeAllocatedQty: number;
      availableQty: number;
      sourceWorkOrderId?: number | null;
    }>;
  } | null;
  recoveryDecisions?: {
    requirementSheetId: number;
    salesOrderId: number;
    status: string;
    items: Array<{
      decisionId: number;
      itemId: number;
      itemName?: string | null;
      uom?: string | null;
      decisionStatus: string;
      customerDemandQty: number;
      productionShortfallQty: number;
      qcFinalRejectionQty: number;
      pendingRecoveryQty: number;
      finalRsQty: number;
      reason?: string | null;
      sources?: Array<{
        recoverySourceId: number;
        recoveryType: string;
        availableQty?: number;
        effect?: string;
        sourceRsDocNo?: string | null;
        sourceRsId?: number | null;
        cycleNo?: number | null;
        cycleId?: number | null;
        sourceWorkOrderId?: number | null;
        workOrderDocNo?: string | null;
        recoveryStatus?: string;
      }>;
    }>;
  } | null;
};

function sheetVersionNum(v: number | null | undefined): number {
  const n = Number(v ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function formatRsSheetOptionLabel(s: SheetListRow, noQty: boolean): string {
  const period = s.periodKey ?? "—";
  const v = String(s.version ?? 1);
  const st = s.status;
  if (noQty && s.cycleNo != null && Number.isFinite(Number(s.cycleNo)) && Number(s.cycleNo) > 0) {
    return `Cycle ${Number(s.cycleNo)} · RS #${s.id} · ${period} · v${v} · ${st}`;
  }
  return `${period} · v${v} · ${st}`;
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

/**
 * Draft: matches backend `productionRequiredQty` / `totalRsQty` composition.
 * NO_QTY: base + production shortfall + QC recovery (+ adj); shortfall applies even when base = 0.
 */
export function computeDraftProductionRequired(line: SheetLine, isNoQtyOrder: boolean): number {
  const newWo = safeNum(line.newWoQty ?? line.requirementQty ?? line.baseDemandQty);
  if (isNoQtyOrder) {
    if (line.totalRsQty != null && Number.isFinite(Number(line.totalRsQty)) && safeNum(line.totalRsQty) > PLAN_EPS) {
      return Math.max(0, Math.round(safeNum(line.totalRsQty) * 1000) / 1000);
    }
    const short = safeNum(line.productionShortfallQty ?? line.shortfallQty);
    const qc = safeNum(line.qcRejectionRecoveryQty);
    const adj = safeNum(line.approvedManualAdjustmentQty);
    return Math.max(0, Math.round((short + newWo + qc + adj) * 1000) / 1000);
  }
  const stock = usableDisplayStock(line.availableStockQty);
  const post = safeNum(line.postCycleApprovalQty);
  const gross =
    line.fulfillmentQty != null && Number.isFinite(Number(line.fulfillmentQty))
      ? safeNum(line.fulfillmentQty)
      : safeNum(line.shortfallQty) + newWo;
  const r = gross > PLAN_EPS ? gross : 0;
  const gapPercent = r > 0 ? round2(((r - stock) / r) * 100) : null;
  let pr = Math.max(0, Math.round((gross - post - stock) * 1000) / 1000);
  if (gapPercent != null && gapPercent < 0) pr = 0;
  return pr;
}

/** System recommendation for new requirement only: max(0, new requirement − free surplus usable). */
function computeSystemSuggestedNet(newReq: number, stock: number): number {
  if (!(newReq > PLAN_EPS)) return 0;
  return Math.max(0, Math.round((newReq - stock) * 1000) / 1000);
}

export function RequirementSheetPage() {
  const { id: soIdParam } = useParams<{ id: string }>();
  const soId = Number(soIdParam);
  const nav = useNavigate();
  const location = useLocation();
  const executionNavContext = useStoreExecutionNavContext("execution-workspace");
  const [searchParams] = useSearchParams();
  const fromNoQtySo = (searchParams.get("source") || searchParams.get("from") || "").toLowerCase() === "no_qty_so";
  const addRequirementIntent = searchParams.get("intent") === "add";
  /** Dashboard ran prepare-next-requirement-sheet before navigation; skip duplicate prepare on mount. */
  const fromDashboard = searchParams.get("fromDashboard") === "1";
  const fromSoCreated = searchParams.get("from") === "so_created";
  const fromPendingActions = searchParams.get("from") === "pending-actions";
  const skipPrepareNextOnMount = fromDashboard || fromSoCreated || fromPendingActions;
  /** Guided NO_QTY navigation often includes `cycleId` before SO header re-hydrates after prepare-next. */
  const cycleIdFromUrl = React.useMemo(() => {
    const raw = searchParams.get("cycleId");
    if (raw == null) return null;
    const s = raw.trim();
    if (!/^\d{1,15}$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }, [searchParams]);

  const createNewSheetRef = React.useRef<HTMLDivElement | null>(null);
  const firstNewReqQtyRef = React.useRef<HTMLInputElement | null>(null);
  const toast = useToast();
  const { user } = useAuth();
  const viewerRole = user?.role ?? null;
  const canOpenRs = useCanOpenRequirementSheet();
  const canCreateNextRs = useCanCreateNextRs();

  const [so, setSo] = React.useState<SoHeader | null>(null);
  const [sheets, setSheets] = React.useState<SheetListRow[]>([]);
  const [selectedSheetId, setSelectedSheetId] = React.useState<number | null>(null);
  const [sheet, setSheet] = React.useState<SheetDetail | null>(null);
  const [periodKey, setPeriodKey] = React.useState("");
  const [remarks, setRemarks] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [pageBootDone, setPageBootDone] = React.useState(false);
  const [needsRecalc, setNeedsRecalc] = React.useState(false);
  const [justDeletedDraft, setJustDeletedDraft] = React.useState(false);
  const [showCreatePanel, setShowCreatePanel] = React.useState(false);
  const [justCreatedSheetId, setJustCreatedSheetId] = React.useState<number | null>(null);
  const [createSelectedItemIds, setCreateSelectedItemIds] = React.useState<number[]>([]);
  /** Draft editor: FG item id to add to the current cycle sheet. */
  const [addDraftItemId, setAddDraftItemId] = React.useState<string>("");
  /** Pre–RS-create new requirement qty (NO_QTY empty active cycle); applied via PUT /lines after POST creates draft. */
  const [pendingNoQtyNewReqQty, setPendingNoQtyNewReqQty] = React.useState<Record<number, string>>({});
  const [woPreviewOpen, setWoPreviewOpen] = React.useState(false);
  const [nextRsPrepareBusy, setNextRsPrepareBusy] = React.useState(false);
  const soCreatedBannerRef = React.useRef<NoQtySoCreatedBannerState | null>(null);
  if (soCreatedBannerRef.current == null) {
    soCreatedBannerRef.current = readNoQtySoCreatedBannerState(location.state, soId);
  }
  const soCreatedBanner = soCreatedBannerRef.current;

  React.useEffect(() => {
    if (!readNoQtySoCreatedBannerState(location.state, soId)) return;
    nav({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [soId, nav, location.pathname, location.search, location.state]);

  const customerName = so?.customer?.name ?? so?.po?.customer?.name ?? "—";
  const selectedPeriod = sheet?.periodKey ?? null;
  const selectedVersion = sheetVersionNum(sheet?.version);
  const soCycleId =
    so?.currentCycle?.id != null && Number.isFinite(Number(so.currentCycle.id)) && Number(so.currentCycle.id) > 0
      ? Number(so.currentCycle.id)
      : so?.currentCycleId != null && Number.isFinite(Number(so.currentCycleId)) && Number(so.currentCycleId) > 0
        ? Number(so.currentCycleId)
        : null;
  const activePlanningCycleId = React.useMemo(() => {
    // Explicit WO-placement / register deep link: keep URL cycle (may be prior CLOSED cycle).
    if (shouldHonorExplicitRsExecutionIdentity({ searchParams, addRequirementIntent })) {
      return resolveExecutionViewCycleId({
        searchParams,
        soCurrentCycleId: soCycleId,
        addRequirementIntent,
      });
    }
    if (addRequirementIntent && fromNoQtySo && cycleIdFromUrl != null) {
      if (soCycleId == null) return cycleIdFromUrl;
      if (so?.orderType !== "NO_QTY") return soCycleId;
      if (soCycleId !== cycleIdFromUrl) {
        return fromDashboard ? cycleIdFromUrl : soCycleId;
      }
      return soCycleId;
    }
    return soCycleId;
  }, [addRequirementIntent, fromNoQtySo, cycleIdFromUrl, fromDashboard, so?.orderType, soCycleId, searchParams]);
  const isNoQty = so?.orderType === "NO_QTY";
  const cycleNo = so?.currentCycle?.cycleNo != null ? Number(so.currentCycle.cycleNo) : null;
  const sheetDisplayCycleNo = React.useMemo(() => {
    if (!sheet) return cycleNo;
    const fromList = sheets.find((x) => x.id === sheet.id)?.cycleNo;
    if (fromList != null && Number(fromList) > 0) return Number(fromList);
    return cycleNo;
  }, [sheet, sheets, cycleNo]);
  const nextCycleNoForRs = React.useMemo(() => {
    if (sheetDisplayCycleNo != null && sheetDisplayCycleNo > 0) return sheetDisplayCycleNo + 1;
    if (cycleNo != null && cycleNo > 0) return cycleNo + 1;
    return null;
  }, [sheetDisplayCycleNo, cycleNo]);

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

  async function loadSoAndSheets(opts?: { forceReselect?: boolean }) {
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
    const forceReselect = opts?.forceReselect === true;
    const existsSelected =
      !forceReselect && selectedSheetId != null && rows.some((r) => r.id === selectedSheetId);

    // Explicit execution identity from Pending Actions / Register must win over ACTIVE-cycle auto-pick.
    const explicitSheetId = resolveExplicitExecutionSheetId(searchParams);
    const honorExplicit = shouldHonorExplicitRsExecutionIdentity({ searchParams, addRequirementIntent });
    if (honorExplicit && explicitSheetId != null && rows.some((r) => Number(r.id) === explicitSheetId)) {
      setSelectedSheetId(explicitSheetId);
      return;
    }

    if (!existsSelected) {
      // Prefer: active cycle + latest DRAFT, else latest LOCKED, else latest by id (stable).
      // In "intent=add" mode, never auto-select a LOCKED sheet (history) as the working sheet.
      const scoped =
        soRow?.orderType === "NO_QTY" && activeId != null
          ? rows.filter((r) => Number(r.cycleId ?? 0) === Number(activeId))
          : soRow?.orderType === "NO_QTY"
            ? []
            : rows;
      const sortKey = (r: SheetListRow) => (r.createdAt ? new Date(r.createdAt).getTime() : r.id);
      const drafts = scoped.filter((r) => r.status === "DRAFT").sort((a, b) => sortKey(b) - sortKey(a));
      const lockedRows = scoped.filter((r) => r.status === "LOCKED").sort((a, b) => sortKey(b) - sortKey(a));
      const pick = addRequirementIntent ? drafts[0] ?? null : drafts[0] ?? lockedRows[0] ?? scoped.sort((a, b) => sortKey(b) - sortKey(a))[0] ?? null;
      setSelectedSheetId(pick?.id ?? null);
    }
  }

  const sheetIdRawFromUrl = React.useMemo(() => {
    const fromSheet = Number(searchParams.get("sheetId") || "");
    const fromGuided = Number(searchParams.get("requirementSheetId") || "");
    const raw =
      Number.isFinite(fromSheet) && fromSheet > 0
        ? fromSheet
        : Number.isFinite(fromGuided) && fromGuided > 0
          ? fromGuided
          : NaN;
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }, [searchParams]);

  /** For NO_QTY + intent=add, ignore guided/list sheet ids unless that row is on the active planning cycle (avoids stale locked RS from prior cycle in URL). */
  const sheetIdFromUrl = React.useMemo(() => {
    if (sheetIdRawFromUrl == null) return null;
    if (!addRequirementIntent || !isNoQty) return sheetIdRawFromUrl;
    if (activePlanningCycleId == null) return null;
    const ac = Number(activePlanningCycleId);
    if (!Number.isFinite(ac) || ac <= 0) return null;
    if (sheets.length === 0) return null;
    const row = sheets.find((s) => Number(s.id) === Number(sheetIdRawFromUrl));
    if (!row) return null;
    const rc = row.cycleId != null ? Number(row.cycleId) : NaN;
    if (!Number.isFinite(rc) || rc !== ac) return null;
    return sheetIdRawFromUrl;
  }, [sheetIdRawFromUrl, addRequirementIntent, isNoQty, activePlanningCycleId, sheets]);

  const lastAppliedSheetParamRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    lastAppliedSheetParamRef.current = null;
  }, [sheetIdRawFromUrl]);

  /** Strip stale sheet deep-links from the address bar so they are not re-applied after navigation. */
  React.useEffect(() => {
    if (!addRequirementIntent || !isNoQty || activePlanningCycleId == null || sheets.length === 0) return;
    const ac = Number(activePlanningCycleId);
    if (!Number.isFinite(ac) || ac <= 0) return;
    const rawSheet = searchParams.get("sheetId");
    const rawGuided = searchParams.get("requirementSheetId");
    if (!rawSheet && !rawGuided) return;
    const rawId = Number(rawSheet || rawGuided || 0);
    if (!Number.isFinite(rawId) || rawId <= 0) return;
    const row = sheets.find((s) => Number(s.id) === rawId);
    if (!row) return;
    const rc = row.cycleId != null ? Number(row.cycleId) : NaN;
    if (!Number.isFinite(rc) || rc === ac) return;
    const next = new URLSearchParams(searchParams);
    next.delete("sheetId");
    next.delete("requirementSheetId");
    next.delete("fromStep");
    const qs = next.toString();
    nav({ pathname: location.pathname, search: qs ? `?${qs}` : "" }, { replace: true });
  }, [addRequirementIntent, isNoQty, activePlanningCycleId, sheets, searchParams, location.pathname, nav]);

  React.useEffect(() => {
    if (sheetIdFromUrl == null) return;
    if (lastAppliedSheetParamRef.current === sheetIdFromUrl) return;
    if (sheets.length === 0) return;
    const row = sheets.find((s) => s.id === sheetIdFromUrl);
    if (!row) return;
    if (addRequirementIntent && isNoQty) {
      if (activePlanningCycleId == null) return;
      const rc = row.cycleId != null ? Number(row.cycleId) : NaN;
      const ac = Number(activePlanningCycleId);
      if (!Number.isFinite(rc) || !Number.isFinite(ac) || rc !== ac) return;
    }
    lastAppliedSheetParamRef.current = sheetIdFromUrl;
    setSelectedSheetId(sheetIdFromUrl);
  }, [sheetIdFromUrl, sheets, addRequirementIntent, isNoQty, activePlanningCycleId]);

  async function loadSelectedSheet(id: number): Promise<SheetDetail> {
    setError(null);
    setSuccess(null);
    const s = await apiFetch<SheetDetail>(`/api/requirement-sheets/${id}`);
    setSheet(s);
    setRemarks(s.remarks?.trim() ?? "");
    setNeedsRecalc(false);
    return s;
  }

  async function cancelLockedSheet() {
    if (!sheet) return;
    const ok = window.confirm(
      "Cancel and reopen this locked requirement sheet? This is allowed only when no downstream execution exists. The document remains in audit history and this Sales Order can create a fresh Requirement Sheet.",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/requirement-sheets/${sheet.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: null }),
      });
      setSuccess("Requirement Sheet cancelled successfully. This Sales Order is ready for a fresh Requirement Sheet.");
      await loadSoAndSheets();
      await loadSelectedSheet(sheet.id);
    } catch (e) {
      const msg =
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to cancel requirement sheet.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    if (!Number.isFinite(soId) || soId <= 0) {
      setError("Invalid sales order.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (addRequirementIntent && !skipPrepareNextOnMount) {
          try {
            await apiFetch(`/api/sales-orders/${soId}/no-qty-cycle/prepare-next-requirement-sheet`, {
              method: "POST",
              body: JSON.stringify({}),
            });
          } catch {
            /* eligibility blocks advancement or transient error — still load SO */
          }
        }
        if (addRequirementIntent) {
          setSelectedSheetId(null);
        }
        if (cancelled) return;
        await loadSoAndSheets({ forceReselect: addRequirementIntent });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load.");
      } finally {
        if (!cancelled) setPageBootDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soId, addRequirementIntent, skipPrepareNextOnMount]);

  React.useEffect(() => {
    if (!addRequirementIntent || !Number.isFinite(soId) || soId <= 0) return;
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    setPeriodKey(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }, [addRequirementIntent, soId]);

  // When opened via "Create Next RS" intent:
  // - If a DRAFT exists in the active cycle, open that draft (do not start a new sheet).
  // - Else show the create panel and do not auto-open locked history.
  // - Never pick a draft from another cycle: require SO current cycle id before selecting.
  React.useEffect(() => {
    if (!addRequirementIntent) return;
    if (!isNoQty) return;
    const activeId = so?.currentCycle?.id ?? so?.currentCycleId ?? null;
    if (activeId == null || !Number.isFinite(Number(activeId)) || Number(activeId) <= 0) {
      setSelectedSheetId(null);
      setShowCreatePanel(true);
      return;
    }
    const scoped = sheets.filter((s) => Number(s.cycleId ?? 0) === Number(activeId));
    const sortKey = (r: SheetListRow) => (r.createdAt ? new Date(r.createdAt).getTime() : r.id);
    const drafts = scoped.filter((s) => s.status === "DRAFT").sort((a, b) => sortKey(b) - sortKey(a));
    const draftId = drafts.length ? Number(drafts[0].id) : null;
    if (draftId != null && Number.isFinite(draftId) && draftId > 0) {
      setSelectedSheetId(draftId);
      setShowCreatePanel(false);
      return;
    }
    const lockedRows = scoped.filter((s) => s.status === "LOCKED").sort((a, b) => sortKey(b) - sortKey(a));
    const lockedId = lockedRows.length ? Number(lockedRows[0].id) : null;
    if (lockedId != null && Number.isFinite(lockedId) && lockedId > 0) {
      setSelectedSheetId(lockedId);
      setShowCreatePanel(false);
      return;
    }
    setSelectedSheetId(null);
    setShowCreatePanel(true);
  }, [addRequirementIntent, isNoQty, sheets, so?.currentCycle?.id, so?.currentCycleId]);

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

  /** Drop cross-cycle detail if intent=add landed on a stale id before SO/sheets aligned. */
  React.useEffect(() => {
    if (!addRequirementIntent || !isNoQty) return;
    if (sheet == null || activePlanningCycleId == null) return;
    const sc = sheet.cycleId != null ? Number(sheet.cycleId) : NaN;
    const ac = Number(activePlanningCycleId);
    if (Number.isFinite(sc) && Number.isFinite(ac) && sc !== ac) {
      setSelectedSheetId(null);
    }
  }, [addRequirementIntent, isNoQty, sheet, activePlanningCycleId]);

  async function createNewSheet() {
    if (!periodKey.trim()) {
      setError("Period is required (e.g. 2026-04).");
      return;
    }
    if (isNoQty && activePlanningCycleId != null) {
      const ac = Number(activePlanningCycleId);
      const onActiveCycle = sheets.filter((s) => Number(s.cycleId ?? 0) === ac);
      if (onActiveCycle.some((s) => s.status === "LOCKED") && !onActiveCycle.some((s) => s.status === "DRAFT")) {
        setError("This cycle already has a locked Requirement Sheet. Continue with Monthly Planning.");
        return;
      }
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
      // Ensure the newly created draft is immediately selected and loaded (no "blank right side" state).
      await loadSoAndSheets();
      setSelectedSheetId(created.id);
      let detail = await loadSelectedSheet(created.id);
      if (isNoQty && Object.keys(pendingNoQtyNewReqQty).length > 0) {
        const linePayload = (Array.isArray(detail.lines) ? detail.lines : []).map((l) => ({
          itemId: l.itemId,
          requirementQty: Math.max(0, safeNum(pendingNoQtyNewReqQty[l.itemId])),
        }));
        if (linePayload.some((ln) => ln.requirementQty > PLAN_EPS)) {
          await apiFetch(`/api/requirement-sheets/${created.id}/lines`, {
            method: "PUT",
            body: JSON.stringify({ lines: linePayload }),
          });
          detail = await loadSelectedSheet(created.id);
        }
      }
      setPendingNoQtyNewReqQty({});
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
      // Persist demand + recalculate accepted surplus atomically (authoritative Net Production Requirement).
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
      setSuccess("Draft saved. Quantities recalculated.");
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

  async function addDraftFgItem() {
    if (!sheet?.id || sheet.status !== "DRAFT") return;
    const itemId = Number(addDraftItemId);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      setError("Select an FG item to add.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/requirement-sheets/${sheet.id}/lines`, {
        method: "POST",
        body: JSON.stringify({ itemId }),
      });
      const next = await apiFetch<SheetDetail>(`/api/requirement-sheets/${sheet.id}`);
      setSheet(next);
      setAddDraftItemId("");
      setNeedsRecalc(true);
      setSuccess("FG item added to this cycle.");
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Failed to add item.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function removeDraftFgItem(itemId: number) {
    if (!sheet?.id || sheet.status !== "DRAFT") return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/requirement-sheets/${sheet.id}/lines/${itemId}`, { method: "DELETE" });
      const next = await apiFetch<SheetDetail>(`/api/requirement-sheets/${sheet.id}`);
      setSheet(next);
      setNeedsRecalc(true);
      setSuccess("FG item removed from this cycle.");
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Failed to remove item.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const sheetCycleIdForAlign = sheet?.cycleId != null ? Number(sheet.cycleId) : NaN;
  const sheetOnActiveCycle =
    Boolean(sheet) &&
    activePlanningCycleId != null &&
    Number.isFinite(sheetCycleIdForAlign) &&
    Number.isFinite(Number(activePlanningCycleId)) &&
    sheetCycleIdForAlign === Number(activePlanningCycleId);

  const locked = sheet?.status === "LOCKED";
  const cancelled = sheet?.status === "CANCELLED";
  useUnsavedChangesGuard({
    isDirty: Boolean(needsRecalc && !locked && !cancelled),
    message: "Requirement Sheet has unsaved quantity changes. Leave and discard them?",
  });
  // Editing is blocked for LOCKED/CANCELLED sheets, older versions, or a sheet row that belongs to a different cycle than SO current.
  const editingDisabled =
    Boolean(sheet) && (!isLatestForPeriod || locked || cancelled || (isNoQty && !sheetOnActiveCycle));
  const showOlderVersionBanner = Boolean(sheet) && !isLatestForPeriod;

  async function lockSheet() {
    if (!sheet) return;
    if (!isLatestForPeriod) return;
    if (needsRecalc) {
      setError("Recalculate or Save draft before finalize — displayed quantities may be stale.");
      return;
    }
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
      // Persist current demand lines with lock so Finalize never freezes a stale net.
      const locked = await apiFetch<SheetDetail>(`/api/requirement-sheets/${sheet.id}/lock`, {
        method: "POST",
        body: JSON.stringify({
          lines: (Array.isArray(sheet?.lines) ? sheet!.lines : []).map((l) => ({
            itemId: l.itemId,
            requirementQty: Number(l.requirementQty || 0),
          })),
        }),
      });
      setSheet(locked);
      setRemarks(locked.remarks?.trim() ?? "");
      setNeedsRecalc(false);

      if (isNoQty) {
        const decisionOnly =
          locked.decisionOnlyRecoveryCycle === true ||
          locked.lockHandoff?.executionStartsAt === "DECISION_ONLY_RECOVERY";
        toast.showSuccess(
          decisionOnly
            ? "Recovery decisions locked. Cycle completed without production."
            : "Requirement Sheet locked successfully.",
        );
        await loadSoAndSheets();
        await refreshNoQtyFlowState();

        let flowAfterLock: NoQtyFlowState | null = null;
        try {
          const cycleQs =
            locked.cycleId != null && Number(locked.cycleId) > 0
              ? `?cycleId=${encodeURIComponent(String(locked.cycleId))}`
              : "";
          flowAfterLock = await apiFetch<NoQtyFlowState>(
            `/api/sales-orders/${locked.salesOrderId}/no-qty-flow-state${cycleQs}`,
          );
        } catch {
          flowAfterLock = null;
        }

        const postNav = resolveNoQtyPostRsLockNavigation({
          salesOrderId: locked.salesOrderId,
          cycleId: locked.cycleId ?? flowAfterLock?.canonicalCycleId ?? flowAfterLock?.cycleId ?? null,
          requirementSheetId: locked.id,
          decisionOnlyRecoveryCycle: decisionOnly,
          dispatchableQty: flowAfterLock?.dispatchableQty ?? null,
          hasQcDispatchPending: flowAfterLock?.hasQcDispatchPending ?? null,
          primaryAction: flowAfterLock?.primaryAction ?? flowAfterLock?.nextAction ?? null,
          viewerRole,
          isZeroPlanning,
        });

        if (postNav.kind === "DISPATCH_CONTEXTUAL" && postNav.href) {
          nav(postNav.href, { replace: true });
          return;
        }
        if (postNav.kind === "SO_SUMMARY" && postNav.href) {
          nav(postNav.href, { replace: true });
          return;
        }
        if (postNav.kind === "DASHBOARD" && postNav.href) {
          setShowCreatePanel(false);
          nav(postNav.href, { replace: true });
          return;
        }
        return;
      }

      const woReady = Boolean(locked.workOrderId ?? locked.lockHandoff?.workOrderId);
      const pmrReady = Boolean(
        locked.productionMaterialRequestId ?? locked.lockHandoff?.productionMaterialRequest?.id,
      );
      const lockParts = [
        woReady ? "WO created" : null,
        pmrReady ? "PMR created" : null,
      ].filter(Boolean);
      toast.showSuccess(
        lockParts.length
          ? `Cycle RS locked. ${lockParts.join(" · ")}.`
          : "Cycle RS locked.",
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
      const out = await apiFetch<{
        workOrderId: number;
        workOrderDocNo?: string | null;
        pmrs?: Array<{ workOrderId: number; pmrId: number | null; pmrDocNo?: string | null }>;
      }>(`/api/requirement-sheets/${sheet.id}/create-wo`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const woId = Number(out?.workOrderId);
      if (!Number.isFinite(woId) || woId <= 0) {
        setSuccess("Work Order created.");
        nav("/work-orders");
        return;
      }
      const pmrRow = out.pmrs?.find((p) => Number(p.workOrderId) === woId) ?? out.pmrs?.[0] ?? null;
      let pmrId = pmrRow?.pmrId ?? null;
      let pmrDocNo = pmrRow?.pmrDocNo ?? null;
      if (!pmrId) {
        const ensured = await ensureSubmittedPmrForWorkOrderHandoff(woId);
        pmrId = ensured.pmrId;
        pmrDocNo = ensured.pmrDocNo ?? pmrDocNo;
      }
      const woLabel = out.workOrderDocNo?.trim() || `WO-${woId}`;
      toast.showSuccess(formatPostWoCreateSuccessMessage(`Work Order ${woLabel}`, pmrDocNo));
      nav(
        postWoMaterialIssueHref({
          workOrderId: woId,
          pmrId,
          returnTo: "requirement-sheet",
          requirementSheetId: sheet.id,
          salesOrderId: sheet.salesOrderId,
        }),
      );
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
    let pendingDispositionSum = 0;
    let productionQcPendingSum = 0;
    let newWoSum = 0;
    let totalWoSum = 0;
    let stockSum = 0;
    let postCycleApprovalSum = 0;
    for (const l of lines) {
      const shortfall = safeNum(l.shortfallQty);
      const newWo = safeNum(l.newWoQty ?? l.requirementQty);
      const stock = usableDisplayStock(l.availableStockQty);
      shortfallSum += shortfall;
      pendingDispositionSum += isNoQty ? safeNum(l.pendingQcDispositionQty) : 0;
      productionQcPendingSum += isNoQty ? safeNum(l.productionQcPendingQty) : 0;
      if (isNoQty) postCycleApprovalSum += safeNum(l.postCycleApprovalQty);
      newWoSum += newWo;
      const totalToProduce = locked
        ? safeNum(l.totalWoQty ?? l.productionRequiredQty ?? l.suggestedWoQty ?? l.netProductionRequirementQty)
        : isNoQty
          ? computeLiveNetProductionRequirement({
              customerDemandQty: newWo,
              keptProductionShortageQty: safeNum(l.productionShortfallQty ?? l.shortfallQty),
              keptQcRejectionQty: safeNum(l.qcRejectionRecoveryQty),
              approvedManualAdjustmentQty: safeNum(l.approvedManualAdjustmentQty),
              priorAcceptedExcessQty: safeNum(l.priorAcceptedExcessQty),
              unusedAcceptedExcessQty: safeNum(l.unusedAcceptedExcessQty),
              availableAcceptedSurplusQty: l.availableAcceptedSurplusQty,
            }).netProductionRequirementQty
          : safeNum(l.totalWoQty ?? l.productionRequiredQty ?? computeDraftProductionRequired(l, isNoQty));
      totalWoSum += isNoQty ? totalToProduce : (locked ? safeNum(l.suggestedWoQty) : computeSystemSuggestedNet(newWo, stock));
      stockSum += stock;
    }
    return {
      shortfallSum,
      pendingDispositionSum,
      productionQcPendingSum,
      newWoSum,
      totalWoSum,
      stockSum,
      postCycleApprovalSum,
    };
  }, [sheet, locked, isNoQty]);

  const noQtyPlanningSummary = React.useMemo(() => {
    if (!isNoQty || !sheet || locked) return null;
    const lines = sheet?.lines ?? [];
    let idle = 0;
    let shortage = 0;
    for (const l of lines) {
      if (needsRecalc) continue;
      const productionRequired = safeNum(
        l.totalWoQty ?? l.productionRequiredQty ?? computeDraftProductionRequired(l, true),
      );
      if (productionRequired > PLAN_EPS) shortage++;
      else idle++;
    }
    return { total: lines.length, idle, shortage, needsRecalc };
  }, [isNoQty, sheet, locked, needsRecalc]);

  // --- UI state rules (NO_QTY must be cycle-scoped) ---
  const cycleScopedSheets =
    isNoQty && activePlanningCycleId != null
      ? sheets.filter((s) => Number(s.cycleId ?? 0) === Number(activePlanningCycleId))
      : isNoQty && addRequirementIntent && activePlanningCycleId == null
        ? // SO current cycle not hydrated yet — do not treat every historical sheet as "this cycle" (breaks empty-cycle Next RS UI).
          []
        : sheets;
  const rsVersionSelectSheets = React.useMemo(() => {
    if (!isNoQty || !sheet || !locked || sheetOnActiveCycle || sheet.cycleId == null) {
      return cycleScopedSheets;
    }
    const viewCycleId = Number(sheet.cycleId);
    if (!Number.isFinite(viewCycleId) || viewCycleId <= 0) return cycleScopedSheets;
    return sheets.filter((s) => Number(s.cycleId ?? 0) === viewCycleId);
  }, [isNoQty, sheet, locked, sheetOnActiveCycle, sheet?.cycleId, sheets, cycleScopedSheets]);
  const hasAnySheets = cycleScopedSheets.length > 0;
  const noSheetsUi = !hasAnySheets;

  /** Dashboard Next RS → active cycle has no RS rows in list (and/or detail is off-cycle): keep create workspace visible even when `sheet` is stale non-null. */
  const showNoQtyEmptyCycleCreateWorkspace = React.useMemo(() => {
    if (!addRequirementIntent || !isNoQty) return false;
    if (activePlanningCycleId == null) {
      return selectedSheetId == null;
    }
    const ac = Number(activePlanningCycleId);
    if (!Number.isFinite(ac) || ac <= 0) return selectedSheetId == null;
    const rowsOnActiveCycle = sheets.filter((s) => Number(s.cycleId ?? 0) === ac);
    if (rowsOnActiveCycle.length > 0) return false;
    if (sheet != null && !sheetOnActiveCycle) return true;
    if (selectedSheetId == null) return true;
    const sel = sheets.find((s) => Number(s.id) === Number(selectedSheetId));
    return !sel || Number(sel.cycleId ?? 0) !== ac;
  }, [
    addRequirementIntent,
    isNoQty,
    activePlanningCycleId,
    selectedSheetId,
    sheets,
    sheet,
    sheetOnActiveCycle,
  ]);

  React.useEffect(() => {
    if (!showNoQtyEmptyCycleCreateWorkspace) {
      setPendingNoQtyNewReqQty({});
      return;
    }
    setPendingNoQtyNewReqQty((prev) => {
      const next: Record<number, string> = {};
      for (const id of createSelectedItemIds) {
        next[id] = prev[id] ?? "";
      }
      return next;
    });
  }, [showNoQtyEmptyCycleCreateWorkspace, createSelectedItemIds]);

  React.useEffect(() => {
    if (!showNoQtyEmptyCycleCreateWorkspace || !so) return;
    const opts = fgItemOptionsFromSo(so);
    if (opts.length === 0) return;
    setCreateSelectedItemIds((prev) => (prev.length > 0 ? prev : opts.map((x) => x.itemId)));
  }, [showNoQtyEmptyCycleCreateWorkspace, so]);

  /** Pre-create NO_QTY preview: last shortage is unknown until draft/recalc — use 0 for totals strip only. */
  const noQtyEmptyCreatePreview = React.useMemo(() => {
    if (!showNoQtyEmptyCycleCreateWorkspace || !so) {
      return { rows: [] as Array<{ itemId: number; itemName: string; raw: string; newReq: number; previewTot: number }>, newSum: 0, totSum: 0 };
    }
    let newSum = 0;
    let totSum = 0;
    const rows = fgItemOptionsFromSo(so)
      .filter((o) => createSelectedItemIds.includes(o.itemId))
      .map((o) => {
        const raw = pendingNoQtyNewReqQty[o.itemId] ?? "";
        const newReq = safeNum(raw);
        newSum += newReq;
        const line: SheetLine = {
          itemId: o.itemId,
          itemName: o.itemName,
          requirementQty: raw || "0",
          newWoQty: raw,
          shortfallQty: 0,
          availableStockQty: 0,
          postCycleApprovalQty: 0,
        };
        const previewTot = computeDraftProductionRequired(line, true);
        totSum += previewTot;
        return { itemId: o.itemId, itemName: o.itemName, raw, newReq, previewTot };
      });
    return { rows, newSum, totSum };
  }, [showNoQtyEmptyCycleCreateWorkspace, so, createSelectedItemIds, pendingNoQtyNewReqQty]);

  // Strict state-driven UI: base banners/actions on the SELECTED sheet only.
  // This prevents stale "draft" UI from showing after the selected sheet is locked.
  const draftUi = sheet?.status === "DRAFT";
  const lockedUi = sheet?.status === "LOCKED";

  const draftRowsInCycle = React.useMemo(
    () => cycleScopedSheets.filter((r) => r.status === "DRAFT"),
    [cycleScopedSheets],
  );
  /** Active cycle already has a locked RS and no draft — RS creation is complete for this cycle. */
  const activeCycleHasLockedRsOnly = React.useMemo(
    () =>
      isNoQty &&
      hasAnySheets &&
      draftRowsInCycle.length === 0 &&
      cycleScopedSheets.some((r) => r.status === "LOCKED"),
    [isNoQty, hasAnySheets, draftRowsInCycle.length, cycleScopedSheets],
  );
  /** Another DRAFT row exists in this cycle besides the sheet currently loaded. */
  const hasOtherUnfinishedDraft =
    draftUi && sheet?.id != null && draftRowsInCycle.some((r) => Number(r.id) !== Number(sheet.id));
  /** Version dropdown selection matches the loaded detail (same draft already open). */
  const selectionMatchesOpenDraft =
    sheet?.id != null && selectedSheetId != null && Number(selectedSheetId) === Number(sheet.id);
  /** Redundant "Continue draft" only when this same draft is selected+open and no other draft exists. */
  const continueDraftRedundant = draftUi && selectionMatchesOpenDraft && !hasOtherUnfinishedDraft;

  const noQtyIntentEmptyActiveCycle =
    Boolean(addRequirementIntent && isNoQty && activePlanningCycleId != null && draftRowsInCycle.length === 0);

  /** P10-A7 — always surface creation workspace when active cycle has no RS rows yet. */
  const showNoQtyCreateWorkspace =
    !activeCycleHasLockedRsOnly &&
    (showCreatePanel || showNoQtyEmptyCycleCreateWorkspace || (isNoQty && noSheetsUi));

  const showNoQtyFinalizeActions =
    isNoQty && Boolean(sheet) && sheetOnActiveCycle && draftUi && isLatestForPeriod;

  const primaryMode: "DRAFT" | "EMPTY" | "LOCKED" = draftUi ? "DRAFT" : lockedUi ? "LOCKED" : "EMPTY";

  /** P8F-A18 — locked-cycle continuation lives in the success panel; avoid duplicate Next RS banner above. */
  const showNoQtyLockedRsContextPanel =
    isNoQty && lockedUi && Boolean(sheet) && sheetOnActiveCycle && !showCreatePanel;

  const flowStateCycleIdForApi = React.useMemo(
    () =>
      resolveRequirementSheetFlowStateCycleId({
        isNoQty,
        addRequirementIntent,
        activePlanningCycleId,
        sheetCycleId: sheet?.cycleId ?? null,
      }),
    [isNoQty, sheet?.cycleId, activePlanningCycleId, addRequirementIntent],
  );

  const {
    state: noQtyFlowState,
    refresh: refreshNoQtyFlowState,
  } = useNoQtyFlowState(
    Number.isFinite(soId) && soId > 0 ? soId : null,
    Boolean(soId > 0 && (fromNoQtySo || isNoQty)),
    { cycleId: flowStateCycleIdForApi },
  );

  React.useEffect(() => {
    if (!isNoQty || sheet?.status !== "LOCKED") return;
    void refreshNoQtyFlowState();
  }, [isNoQty, sheet?.id, sheet?.status, refreshNoQtyFlowState]);

  const safeLines: SheetLine[] = Array.isArray(sheet?.lines) ? sheet!.lines : [];
  /** True when no suggested WO remains on any line (includes carry-forward covered by operational stock). */
  const isZeroPlanning =
    isNoQty &&
    (safeLines.length === 0 || safeLines.every((l) => Math.abs(computeDraftProductionRequired(l, true)) <= PLAN_EPS));

  const decisionOnlyRecoveryReady = React.useMemo(() => {
    if (!isNoQty || sheet?.status !== "DRAFT") return false;
    return isDecisionOnlyRecoveryCycleReady({
      isNoQty: true,
      sheetStatus: sheet?.status,
      lines: safeLines.map((l) => ({
        newWoQty: l.newWoQty != null && l.newWoQty !== "" ? Number(l.newWoQty) : undefined,
        requirementQty: l.requirementQty != null && l.requirementQty !== "" ? Number(l.requirementQty) : undefined,
        toProduceQty: computeDraftProductionRequired(l, true),
      })),
      recoveryDecisionItems: sheet?.recoveryDecisions?.items ?? [],
    });
  }, [isNoQty, sheet?.status, sheet?.recoveryDecisions?.items, safeLines]);

  /** NO_QTY draft: allow finalize when New requirement / Total to Produce is positive, OR decision-only recovery complete. */
  const noQtyDraftCanFinalize = React.useMemo(() => {
    if (!isNoQty || sheet?.status !== "DRAFT") return true;
    if (decisionOnlyRecoveryReady) return true;
    if (safeLines.length === 0) return false;
    return safeLines.some((l) => {
      const newReq = safeNum(l.newWoQty ?? l.requirementQty);
      const toProduce = computeDraftProductionRequired(l, true);
      return newReq > PLAN_EPS || toProduce > PLAN_EPS;
    });
  }, [isNoQty, sheet?.status, safeLines, decisionOnlyRecoveryReady]);

  /** Informational only — Pending QC excess never disables Finalize. */
  const producedExcessPendingQcHint = React.useMemo(() => {
    if (!isNoQty || sheet?.status !== "DRAFT") return null;
    for (const l of safeLines) {
      const unitLabel = String(l.unit ?? "").trim() || "Nos";
      const pendingExcess = safeNum(l.producedExcessPendingQcQty);
      if (pendingExcess > PLAN_EPS) {
        return `Pending QC: ${pendingExcess.toLocaleString("en-US", {
          maximumFractionDigits: 3,
        })} ${unitLabel} produced excess (provisional). Finalize uses confirmed quantities; later QC adjusts the active cycle.`;
      }
      if (safeNum(l.unappliedQcAcceptedExcessCreditQty) > PLAN_EPS) {
        return `Carried QC adjustment waiting for the next active cycle: ${safeNum(
          l.unappliedQcAcceptedExcessCreditQty,
        ).toLocaleString("en-US", { maximumFractionDigits: 3 })} ${unitLabel}.`;
      }
      if (safeNum(l.carriedQcAcceptedExcessCreditQty) > PLAN_EPS) {
        return `Carried QC accepted-excess credit on this cycle: ${safeNum(
          l.carriedQcAcceptedExcessCreditQty,
        ).toLocaleString("en-US", { maximumFractionDigits: 3 })} ${unitLabel}.`;
      }
    }
    return null;
  }, [isNoQty, sheet?.status, safeLines]);

  const noQtyFinalizeDisabled =
    !sheet ||
    editingDisabled ||
    busy ||
    needsRecalc ||
    (isNoQty && draftUi && !noQtyDraftCanFinalize);

  const [rsCycleSummaries, setRsCycleSummaries] = React.useState<NoQtyRsCycleSummaryEntry[]>([]);
  const [rsCycleSummaryLoading, setRsCycleSummaryLoading] = React.useState(false);

  React.useEffect(() => {
    if (!isNoQty || sheets.length === 0) {
      setRsCycleSummaries([]);
      return;
    }
    let cancelled = false;
    setRsCycleSummaryLoading(true);
    void loadNoQtyRsCycleSummaries(sheets, { liveSheet: sheet })
      .then((rows) => {
        if (!cancelled) setRsCycleSummaries(rows);
      })
      .catch(() => {
        if (!cancelled) setRsCycleSummaries([]);
      })
      .finally(() => {
        if (!cancelled) setRsCycleSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isNoQty, sheets, sheet?.id, sheet?.status, sheet?.lines]);

  const rsCycleSummaryTotals = React.useMemo(
    () => ({
      previousCycles: totalPreviousCyclesQty(rsCycleSummaries, sheetDisplayCycleNo),
      allCycles: totalAllCyclesQty(rsCycleSummaries),
    }),
    [rsCycleSummaries, sheetDisplayCycleNo],
  );

  const workbenchKpiItems = React.useMemo(
    () =>
      buildRequirementSheetKpiItems({
        isNoQty,
        summary,
        rsCycleSummaryLoading,
        previousCyclesTotal: rsCycleSummaryTotals.previousCycles,
        allCyclesTotal: rsCycleSummaryTotals.allCycles,
        hasSheet: Boolean(sheet) && !showNoQtyEmptyCycleCreateWorkspace,
      }),
    [isNoQty, summary, rsCycleSummaryLoading, rsCycleSummaryTotals, sheet, showNoQtyEmptyCycleCreateWorkspace],
  );

  const workbenchActions = React.useMemo(
    () =>
      resolveRequirementSheetWorkbenchActions({
        isNoQty,
        sheet: sheet
          ? {
              id: sheet.id,
              salesOrderId: sheet.salesOrderId,
              status: sheet.status,
              periodKey: sheet.periodKey,
              cycleId: sheet.cycleId,
            }
          : null,
        showNoQtyCreateWorkspace,
        showNoQtyFinalizeActions,
        noQtyFinalizeDisabled,
        draftUi,
        noQtyDraftCanFinalize,
        producedExcessPendingQcFinalizeMessage: producedExcessPendingQcHint,
        decisionOnlyRecoveryReady,
        busy,
        noSheetsUi,
        canCreateNextRs,
        createNextRsEligible: noQtyFlowState?.createNextRsEligible ?? false,
        nextCycleNoForRs,
        nextRsPrepareBusy,
        readyToPlaceWo: noQtyFlowState?.readyToPlaceWo ?? false,
        processStageKey: noQtyFlowState?.placementProcessStageKey ?? null,
        showNoQtyLockedRsContextPanel,
        locked,
        onFinalize: () => void lockSheet(),
        onCreateSheet: () => {
          setShowCreatePanel(true);
          createNewSheetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        },
        onCreateNewSheetFromEmpty: () => {
          setShowCreatePanel(true);
          createNewSheetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        },
        onPrepareNextRs: () => void prepareNextRsFromLockedFooter(),
      }),
    [
      isNoQty,
      sheet,
      showNoQtyCreateWorkspace,
      showNoQtyFinalizeActions,
      noQtyFinalizeDisabled,
      draftUi,
      noQtyDraftCanFinalize,
      producedExcessPendingQcHint,
      decisionOnlyRecoveryReady,
      busy,
      noSheetsUi,
      canCreateNextRs,
      noQtyFlowState?.createNextRsEligible,
      noQtyFlowState?.readyToPlaceWo,
      noQtyFlowState?.placementProcessStageKey,
      nextCycleNoForRs,
      nextRsPrepareBusy,
      showNoQtyLockedRsContextPanel,
      locked,
      lockSheet,
      prepareNextRsFromLockedFooter,
    ],
  );

  React.useEffect(() => {
    if (!showNoQtyEmptyCycleCreateWorkspace) return;
    if (noQtyEmptyCreatePreview.rows.length === 0) return;
    const timer = window.setTimeout(() => firstNewReqQtyRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [showNoQtyEmptyCycleCreateWorkspace, noQtyEmptyCreatePreview.rows.length]);

  const rsSectionActions = React.useMemo(() => {
    const secondary = [
      ...workbenchActions.secondary,
      ...(sheet
        ? [
            {
              key: "recalc",
              label: "Recalculate",
              onClick: () => void recalc(),
              disabled: !sheet || editingDisabled || busy || isZeroPlanning,
            },
            ...(draftUi
              ? [
                  {
                    key: "save-draft",
                    label: "Save draft",
                    onClick: () => void saveDraft(),
                    disabled: !sheet || editingDisabled || busy,
                  },
                ]
              : []),
          ]
        : []),
    ];
    const hasActions = workbenchActions.primary || secondary.length > 0 || workbenchActions.hint;
    if (!hasActions) return null;
    return {
      primary: workbenchActions.primary,
      secondary,
      hint: workbenchActions.hint,
    };
  }, [
    sheet,
    workbenchActions,
    editingDisabled,
    busy,
    isZeroPlanning,
    draftUi,
    recalc,
    saveDraft,
  ]);

  const showNoQtyExecutionWorkspace = shouldRenderNoQtyExecutionWorkspace({
    hasSheet: Boolean(sheet),
    isNoQty,
    isLocked: locked,
    showNoQtyEmptyCycleCreateWorkspace,
    canOpenRs,
  });

  const showItemsCard = Boolean(
    sheet && (!isNoQty || sheetOnActiveCycle || (locked && showNoQtyExecutionWorkspace)),
  );

  const rsWorkbenchActionCluster = rsSectionActions ? (
    <WorkbenchActionCluster
      primary={rsSectionActions.primary}
      secondary={rsSectionActions.secondary}
      hint={rsSectionActions.hint}
    />
  ) : null;

  /** Items title + Finalize / Recalculate / Save Draft on one compact row (NO_QTY). */
  const rsItemsHeaderActionClassName = isNoQty
    ? "z-20 border-b border-slate-200/90 bg-white px-0 py-0"
    : "sticky top-[var(--erp-app-header-h,3.25rem)] z-20 -mx-3 border-b border-slate-200/90 bg-white/95 px-3 py-1.5 backdrop-blur-sm sm:-mx-0 sm:px-0";

  const executionModeRequested = isExecutionModeRequested(searchParams);
  const useExecutionModeShell = shouldUseNoQtyExecutionModeShell({
    executionModeRequested,
    isNoQty,
    soLoaded: so != null,
  });
  const executionRsLabel =
    sheet != null
      ? displayRequirementSheetNo(sheet.id, sheet.docNo)
      : sheetIdFromUrl != null
        ? displayRequirementSheetNo(sheetIdFromUrl, null)
        : "RS —";

  const priorCycleExecutionContext = React.useMemo(
    () =>
      showNoQtyExecutionWorkspace && locked && !sheetOnActiveCycle
        ? { viewingCycleNo: sheetDisplayCycleNo, isPriorCycle: true as const }
        : null,
    [showNoQtyExecutionWorkspace, locked, sheetOnActiveCycle, sheetDisplayCycleNo],
  );

  React.useEffect(() => {
    if (useExecutionModeShell) return;
    if (searchParams.get("focus") !== "execution" || !showNoQtyExecutionWorkspace) return;
    const timer = window.setTimeout(() => {
      document.getElementById("rs-execution-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [useExecutionModeShell, searchParams, showNoQtyExecutionWorkspace, sheet?.id]);

  const suppressDraftWarningBanner =
    justCreatedSheetId != null && sheet?.id != null && Number(sheet.id) === Number(justCreatedSheetId) && sheet.status === "DRAFT";

  async function prepareNextRsFromLockedFooter() {
    if (!sheet?.salesOrderId) return;
    setNextRsPrepareBusy(true);
    try {
      await prepareNoQtyNextRequirementSheetAndNavigate({
        salesOrderId: sheet.salesOrderId,
        navigate: nav,
        toast,
        navigateState: { from: "requirement-sheet" },
      });
    } finally {
      setNextRsPrepareBusy(false);
    }
  }

  // Create panel: keep open for Dashboard → Next RS until a draft exists on the active cycle;
  // do not force-close just because a stale cross-cycle sheet briefly hydrated.
  React.useEffect(() => {
    const draftCountOnActive =
      activePlanningCycleId != null
        ? sheets.filter(
            (s) => Number(s.cycleId ?? 0) === Number(activePlanningCycleId) && s.status === "DRAFT",
          ).length
        : 0;
    const selectedListRow =
      selectedSheetId != null ? sheets.find((s) => Number(s.id) === Number(selectedSheetId)) : null;
    const selectedRowOnActiveCycle =
      activePlanningCycleId != null &&
      selectedSheetId != null &&
      selectedListRow != null &&
      Number(selectedListRow.cycleId ?? 0) === Number(activePlanningCycleId);
    /** Intent=add: keep create until a draft on the active cycle is the working selection (handles stale / cross-cycle id + SO cycle hydrate). */
    const noQtyIntentAddKeepCreateOpen =
      addRequirementIntent &&
      isNoQty &&
      !selectedRowOnActiveCycle &&
      (activePlanningCycleId == null || draftCountOnActive === 0);
    if (noQtyIntentAddKeepCreateOpen) {
      setShowCreatePanel(true);
      return;
    }
    if (showNoQtyEmptyCycleCreateWorkspace) {
      setShowCreatePanel(true);
      return;
    }
    if (addRequirementIntent && isNoQty && activePlanningCycleId != null) {
      if (draftCountOnActive === 0) {
        setShowCreatePanel(true);
        return;
      }
    }
    if (primaryMode === "EMPTY") {
      // Avoid flashing create while a draft row is already selected but detail has not hydrated yet.
      if (selectedSheetId != null && sheet == null && (addRequirementIntent || isNoQty)) {
        setShowCreatePanel(true);
        return;
      }
      if (!(addRequirementIntent && isNoQty && selectedSheetId != null)) {
        setShowCreatePanel(true);
        return;
      }
    }
    setShowCreatePanel(false);
  }, [
    primaryMode,
    activePlanningCycleId,
    addRequirementIntent,
    isNoQty,
    sheets,
    showNoQtyEmptyCycleCreateWorkspace,
    selectedSheetId,
    sheet,
  ]);

  if (!Number.isFinite(soId) || soId <= 0) {
    return (
      <PageContainer>
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">Invalid sales order.</div>
      </PageContainer>
    );
  }

  if (useExecutionModeShell) {
    return (
      <PageContainer data-testid="no-qty-execution-mode-page">
        <RequirementSheetErrorBoundary>
          <OperationalContextSticky className="space-y-2">
            <ErpWorkflowTrail navContext={executionNavContext} />
            <ExecutionWorkspaceContextHeader
              soLabel={displaySalesOrderNo(soId, so?.docNo)}
              customerName={customerName}
              cycleNo={sheetDisplayCycleNo}
              rsLabel={executionRsLabel}
              rsStatus={sheet?.status}
            />
          </OperationalContextSticky>

          {error ? (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          ) : null}

          {!sheet && !error ? (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Loading work order planning…
            </div>
          ) : null}

          {!showNoQtyExecutionWorkspace && sheet ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Execution workspace is available only for locked requirement sheets.
            </div>
          ) : null}

          {showNoQtyExecutionWorkspace && sheet ? (
            <RequirementSheetExecutionPanel
              sheetId={sheet.id}
              salesOrderId={sheet.salesOrderId}
              canPlaceWoBatch={canOpenRs}
              priorCycleExecution={priorCycleExecutionContext}
              executionMode
              className="mt-2 w-full"
            />
          ) : null}
        </RequirementSheetErrorBoundary>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="erp-workbench-page">
      <RequirementSheetErrorBoundary>
        <WorkbenchShell
          moduleLabel={
            showNoQtyExecutionWorkspace ? WO_PLANNING_UX.PAGE_TITLE : "Requirement Sheet"
          }
        >
          <WorkbenchAlerts>
            <DemoFlowBanner />
            {soCreatedBanner ? (
              <ErpWorkflowBanner
                tone="success"
                className="flex-col items-stretch gap-1.5 sm:flex-row sm:items-start sm:justify-between"
                role="status"
                aria-live="polite"
              >
                <div>
                  <div className="text-[12px] font-semibold text-emerald-950">NO_QTY Sales Order Created</div>
                  <p className="mt-0.5 text-[12px] leading-snug text-emerald-900">
                    Sales Order <span className="font-mono font-semibold tabular-nums">{soCreatedBanner.soNo}</span> created
                    successfully. Continue with Cycle {soCreatedBanner.cycleNo} Requirement Planning.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-emerald-900/90 sm:shrink-0">
                  <span className="max-w-[12rem] truncate" title={soCreatedBanner.customerName}>
                    {soCreatedBanner.customerName}
                  </span>
                  <OpCtxSep />
                  <span className="font-mono tabular-nums">{soCreatedBanner.soNo}</span>
                  <OpCtxSep />
                  <span>NO_QTY</span>
                  <OpCtxSep />
                  <span>Cycle {soCreatedBanner.cycleNo}</span>
                </div>
              </ErpWorkflowBanner>
            ) : null}
            {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
            {success ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{success}</div>
            ) : null}
          </WorkbenchAlerts>

          <WorkbenchHeader
            titleRow={
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[12px] font-semibold text-slate-900">
                  {resolveRequirementSheetWorkbenchPageTitle({
                    isNoQty,
                    showExecutionWorkspace: showNoQtyExecutionWorkspace,
                  })}
                </span>
                {showNoQtyExecutionWorkspace ? (
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-semibold text-emerald-900">
                    RS locked · {WO_PLANNING_UX.STAGE_CURRENT}
                  </span>
                ) : null}
                {isNoQty && fromNoQtySo ? (
                  <PageNoQtyFlowBackLink step="REQUIREMENT" className="mt-0" />
                ) : isNoQty ? (
                  <ERPBackNavigation
                    defaultTo={noQtyAgreementListHref(viewerRole)}
                    defaultLabel={
                      isStoreLikePlanningRole(viewerRole) ? "Back to NO_QTY Execution" : "Back to No Qty Sales Orders"
                    }
                    className="h-8 min-h-8 text-[12px]"
                  />
                ) : null}
              </div>
            }
            contextRow={
              isNoQty && so ? (
                <NoQtyCycleContextBar
                  compact
                  soId={soId}
                  soDocNo={so.docNo ?? null}
                  customerName={customerName}
                  cycleNo={cycleNo}
                  hideErpPlanningAudit
                />
              ) : !isNoQty ? (
                <OperationalContextBar className="mt-0 border-0 bg-transparent p-0 shadow-none">
                  <span className="font-mono font-semibold tabular-nums text-slate-900">{displaySalesOrderNo(soId, so?.docNo)}</span>
                  <OpCtxSep />
                  <span className="max-w-[14rem] truncate font-medium text-slate-900" title={customerName}>
                    {customerName}
                  </span>
                  <OpCtxSep />
                  <span className="rounded border border-slate-200 bg-white px-1.5 py-0 text-[11px] font-semibold text-slate-700">
                    {so?.orderType ?? "—"}
                  </span>
                  <OpCtxSep />
                  <span className="font-mono text-[11px] font-semibold text-violet-900">
                    {sheet
                      ? `${String(sheet.periodKey ?? "—").trim() || "—"} · v${selectedVersion} · ${sheet.status}`
                      : "RS —"}
                  </span>
                </OperationalContextBar>
              ) : null
            }
            workflowRow={
              isNoQty && so ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <ProductionFlowTypeBadge flow={PRODUCTION_FLOW_NO_QTY} />
                  {noQtyFlowState ? <NoQtyMacroLifecycleStrip flow={noQtyFlowState} cycleNo={cycleNo} /> : null}
                  {sheet && Number(sheet.salesOrderId) > 0 && noQtyFlowState && !showNoQtyLockedRsContextPanel ? (
                    <span className="text-[11px] text-slate-600">
                      Next:{" "}
                      <span className="font-semibold text-slate-900">{noQtyNextCycleLabel(nextCycleNoForRs)}</span>
                    </span>
                  ) : null}
                </div>
              ) : null
            }
            toolbarRow={
              sheet && (isNoQty ? sheetOnActiveCycle || locked : true) ? (
                <div className="flex w-full flex-wrap items-center justify-between gap-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-slate-800">
                    {isNoQty && sheetDisplayCycleNo != null && sheetDisplayCycleNo > 0 ? (
                      <span className="rounded border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-violet-950">
                        Cycle {sheetDisplayCycleNo}
                      </span>
                    ) : null}
                    <select
                      className="h-7 max-w-[13rem] rounded-md border border-slate-200 bg-white px-1 text-[12px]"
                      value={selectedSheetId ?? ""}
                      disabled={(isNoQty ? rsVersionSelectSheets : cycleScopedSheets).length === 0}
                      onChange={(e) => setSelectedSheetId(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">
                        {(isNoQty ? rsVersionSelectSheets : cycleScopedSheets).length > 0 ? "Select..." : "No versions"}
                      </option>
                      {(Array.isArray(isNoQty ? rsVersionSelectSheets : cycleScopedSheets)
                        ? isNoQty
                          ? rsVersionSelectSheets
                          : cycleScopedSheets
                        : []
                      ).map((s) => (
                        <option key={s.id} value={s.id}>
                          {formatRsSheetOptionLabel(s, isNoQty)}
                        </option>
                      ))}
                    </select>
                    <Badge variant={sheet.status === "LOCKED" ? "success" : "warning"}>
                      {sheet.status === "LOCKED" ? "Locked" : "Draft"}
                    </Badge>
                    {showOlderVersionBanner ? <Badge variant="default">Older version</Badge> : null}
                  </div>
                  <details className="relative">
                    <summary className="cursor-pointer select-none rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[13px] text-slate-700">
                      ⋯
                    </summary>
                    <div className="absolute right-0 z-10 mt-1 grid w-52 gap-1 rounded-md border border-slate-200 bg-white p-2 text-[13px] shadow-lg">
                      {sheet.status === "DRAFT" && isLatestForPeriod ? (
                        <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void deleteDraftSheet()}>
                          Delete draft
                        </Button>
                      ) : null}
                      <Button type="button" variant="outline" size="sm" disabled={!sheet || busy || needsRecalc} onClick={() => setWoPreviewOpen((o) => !o)}>
                        {woPreviewOpen ? "Hide WO plan" : "WO plan (preview)"}
                      </Button>
                      {locked && viewerRole === "ADMIN" ? (
                        <Button type="button" variant="destructive" size="sm" disabled={busy || cancelled} onClick={() => void cancelLockedSheet()}>
                          Cancel / Reopen Requirement Sheet
                        </Button>
                      ) : null}
                    </div>
                  </details>
                </div>
              ) : null
            }
          />

          <WorkbenchKpiStrip items={workbenchKpiItems} />

          <WorkbenchMain className={cn(isNoQty && showItemsCard && "space-y-0.5")}>
        {isNoQty && !noQtyIntentEmptyActiveCycle && draftUi && !showItemsCard ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-snug text-slate-500">
            <span>Finalize locks this cycle for planning; return to the NO_QTY Sales Order for the next cycle.</span>
            <details className="inline-block">
              <summary className="inline cursor-pointer text-slate-600 underline underline-offset-2">Info</summary>
              <div className="mt-1 max-w-3xl rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 shadow-sm">
                Includes previous cycle shortage. Usable stock from prior cycles is dispatch-only and does not reduce Total to Produce.
              </div>
            </details>
          </div>
        ) : null}
        {fromDashboard && isNoQty && cycleNo != null && !showNoQtyEmptyCycleCreateWorkspace ? (
          <div className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[12px] text-sky-950">
            Continue Requirement Sheet for{" "}
            <span className="font-semibold tabular-nums">Cycle {cycleNo}</span>
          </div>
        ) : null}
        {addRequirementIntent && !showNoQtyCreateWorkspace ? (
          <details className="inline-block text-[11px] text-slate-500">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded border border-slate-200/80 bg-white px-1.5 py-0.5 text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <CircleHelp className="h-3 w-3 shrink-0" aria-hidden />
              <span>Create RS help</span>
            </summary>
            <p className="mt-1 max-w-lg rounded border border-slate-200 bg-white px-2 py-1 text-[11px] leading-snug text-slate-600 shadow-sm">
              New sheets attach to this SO&apos;s active cycle. Use a new period or version when revising the requirement.
            </p>
          </details>
        ) : null}

      {!pageBootDone && !so && sheets.length === 0 && !error ? (
        <ErpPageLoader variant="workspace" hint="Loading requirement sheet…" />
      ) : null}

      {isNoQty && justDeletedDraft && noSheetsUi ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1 text-xs text-amber-950">
          <div className="font-semibold">Draft deleted. Create a new requirement sheet</div>
          <div className="mt-0.5 text-xs text-amber-900">You can now create a fresh requirement sheet for this cycle.</div>
        </div>
      ) : isNoQty && pageBootDone && noSheetsUi && !showNoQtyCreateWorkspace ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-800">
          <div className="font-semibold">No requirement sheet created yet</div>
          <div className="mt-0.5 text-xs text-slate-600">Create a requirement sheet for this cycle to begin planning.</div>
        </div>
      ) : isNoQty && draftUi && !suppressDraftWarningBanner ? (
        <div
          className={cn(
            "rounded-md border px-2 py-1 text-xs",
            !noQtyDraftCanFinalize || !isZeroPlanning
              ? "border-amber-200 bg-amber-50/70 text-amber-950"
              : "border-emerald-200 bg-emerald-50/70 text-emerald-950",
            showItemsCard && "py-0.5",
          )}
        >
          {!noQtyDraftCanFinalize ? (
            <div className="font-semibold leading-snug">
              Awaiting requirement quantities
              {!showItemsCard ? (
                <span className="mt-0.5 block font-normal text-amber-900">Enter requirement qty to continue.</span>
              ) : null}
            </div>
          ) : decisionOnlyRecoveryReady ? (
            <div className="font-semibold leading-snug">
              {DECISION_ONLY_RECOVERY_FINALIZE_MESSAGE}
              {!showItemsCard ? (
                <span className="mt-0.5 block font-normal text-emerald-900">
                  Finalize to lock this recovery cycle — no production is required.
                </span>
              ) : null}
            </div>
          ) : isZeroPlanning ? (
            <div className="font-semibold leading-snug">
              No fresh production qty on this sheet
              {!showItemsCard ? (
                <span className="mt-0.5 block font-normal text-emerald-900">
                  You can finalize when ready (pending QC disposition alone does not drive production here).
                </span>
              ) : null}
            </div>
          ) : (
            <div className="font-semibold leading-snug">
              Unfinished draft requirement sheet
              {!showItemsCard ? (
                <span className="mt-0.5 block font-normal text-amber-900">Continue the draft and finalize when ready.</span>
              ) : null}
            </div>
          )}
          <div className="hidden">
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
        <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-800">
          <div className="font-semibold">Requirement sheet created</div>
          <div className="mt-0.5 text-xs text-slate-600">Enter New requirement Qty, then finalize when ready.</div>
        </div>
      ) : isNoQty && cancelled && sheet && !addRequirementIntent && !showCreatePanel ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-950">
          <div className="font-semibold">Requirement sheet cancelled</div>
          <div className="mt-0.5 text-xs text-amber-900">
            Locked cycle cannot be revised. Create the next cycle instead.
          </div>
        </div>
      ) : showNoQtyLockedRsContextPanel && sheet ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-2 py-1.5 text-xs text-emerald-950">
          <div className="font-semibold">
            {noQtyFlowState?.readyToPlaceWo
              ? `Requirement Sheet locked for ${noQtyCurrentCycleLabel(sheetDisplayCycleNo)}.`
              : "Requirement Sheet locked. Next step depends on Estimated Net RM Requirement (Monthly Planning if Net RM > 0, otherwise Work Order Planning)."}
          </div>
          <div className="mt-0.5 text-xs text-emerald-900">
            {noQtyFlowState?.readyToPlaceWo
              ? "RM is available. Place Work Order batch(es) from the Execution Workspace below."
              : `Cycle ${sheetDisplayCycleNo ?? cycleNo ?? "—"} RS is read-only. Use the primary action below to continue planning.`}
          </div>
        </div>
      ) : null}

      {showNoQtyCreateWorkspace || !sheet ? (
      <div className={noSheetsUi ? "grid gap-6 lg:grid-cols-1" : "grid gap-6 lg:grid-cols-2"}>
        <Card className="min-w-0 overflow-hidden">
          {!sheet || showNoQtyEmptyCycleCreateWorkspace || (isNoQty && noSheetsUi) ? (
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {showNoQtyEmptyCycleCreateWorkspace && cycleNo != null
                    ? `Create Requirement Sheet — Cycle ${cycleNo}`
                    : primaryMode === "EMPTY"
                      ? "Create requirement sheet"
                      : "Versions"}
                </CardTitle>
                {!showItemsCard && !showNoQtyCreateWorkspace ? rsWorkbenchActionCluster : null}
              </div>
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
                      {formatRsSheetOptionLabel(s, isNoQty)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {showNoQtyCreateWorkspace ? (
              <div
                ref={createNewSheetRef}
                className={
                  addRequirementIntent
                    ? "grid gap-2 rounded-md border border-emerald-300 bg-emerald-50/40 p-3 ring-1 ring-emerald-200/70"
                    : "grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
                }
              >
                <div className="text-xs font-medium text-slate-700">
                  {showNoQtyEmptyCycleCreateWorkspace && cycleNo != null
                    ? `New cycle ${cycleNo} — add requirement quantities, then create the draft.`
                    : isNoQty
                      ? "Create requirement sheet"
                      : primaryMode === "EMPTY"
                        ? "Start requirement sheet"
                        : "Create new version"}
                </div>
                {!showNoQtyEmptyCycleCreateWorkspace ? (
                  <div className="text-xs text-slate-600">
                    <span className="font-medium text-slate-800">Only selected items will be planned in this cycle.</span>{" "}
                    Select the FG items you want to plan. Items are not auto-included.
                  </div>
                ) : (
                  <div className="rounded-md border border-sky-200/80 bg-sky-50/90 px-2.5 py-2 text-[11px] leading-snug text-sky-950">
                    <div className="font-semibold text-sky-950">Planning preview (before draft)</div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                      <span>
                        <span className="text-sky-800/90">Last shortage</span>{" "}
                        <span className="font-semibold">—</span>
                        <span className="text-sky-800/80"> (set after create + recalc)</span>
                      </span>
                      <span>
                        <span className="text-sky-800/90">New requirement</span>{" "}
                        <span className="font-semibold">{noQtyEmptyCreatePreview.newSum.toFixed(3).replace(/\.000$/, "")}</span>
                      </span>
                      <span>
                        <span className="text-sky-800/90">Total to Produce</span>{" "}
                        <span className="font-semibold">{noQtyEmptyCreatePreview.totSum.toFixed(3).replace(/\.000$/, "")}</span>
                        <span className="font-normal text-sky-800/80"> (shortage treated as 0 until draft)</span>
                      </span>
                    </div>
                  </div>
                )}
                {showNoQtyEmptyCycleCreateWorkspace ? (
                  noQtyEmptyCreatePreview.rows.length === 0 ? (
                    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      No FG items in scope. Open “FG item scope” below and select at least one line.
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {noQtyEmptyCreatePreview.rows.map((row, rowIdx) => {
                        const fmt = (n: number) => n.toFixed(3).replace(/\.000$/, "");
                        return (
                          <div key={row.itemId} className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
                            <div className="text-sm font-semibold text-slate-900">{row.itemName}</div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <div>
                                <div className="text-[11px] font-medium text-slate-600">New Requirement Qty</div>
                                <Input
                                  ref={rowIdx === 0 ? firstNewReqQtyRef : undefined}
                                  className="mt-0.5 h-9 w-full tabular-nums text-[14px]"
                                  value={row.raw}
                                  disabled={busy}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setPendingNoQtyNewReqQty((prev) => ({ ...prev, [row.itemId]: v }));
                                  }}
                                  placeholder="0"
                                />
                              </div>
                              <div className="rounded-md border border-slate-100 bg-slate-50/90 p-2">
                                <div className="text-[11px] font-medium text-slate-600">Total to Produce (preview)</div>
                                <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-950">{fmt(row.previewTot)}</div>
                                <div className="mt-0.5 text-[10px] text-slate-500">Last shortage: — until draft exists</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : null}
                {showNoQtyEmptyCycleCreateWorkspace ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <span className="text-xs font-medium text-slate-600">Period (YYYY-MM)</span>
                      <Input
                        value={periodKey}
                        onChange={(e) => setPeriodKey(e.target.value)}
                        placeholder="2026-04"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-9 w-full font-semibold shadow-sm"
                        disabled={busy}
                        onClick={() => void createNewSheet()}
                      >
                        {busy ? "Working…" : "Create Requirement Sheet"}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {sheet?.status && (sheet.periodKey ?? "").trim() && periodKey.trim() === String(sheet.periodKey ?? "").trim() ? (
                  <div className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                    <div className="font-semibold text-slate-800">Previous version items (reference)</div>
                    <div className="mt-0.5 text-slate-600">
                          {(sheet?.lines || []).map((l) => l.itemName).join(", ") || "—"}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">These are not auto-selected. Choose items below.</div>
                  </div>
                ) : null}
                {showNoQtyEmptyCycleCreateWorkspace ? (
                  (() => {
                    const opts = fgItemOptionsFromSo(so);
                    if (opts.length === 0) {
                      return (
                        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          No FG items found on this sales order.
                        </div>
                      );
                    }
                    return (
                      <details className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                        <summary className="cursor-pointer select-none text-[12px] font-medium text-slate-700">FG item scope (optional)</summary>
                        <div className="mt-2 grid gap-2">
                          <div className="grid gap-1">
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
                            <Button type="button" variant="outline" disabled={busy} onClick={() => setCreateSelectedItemIds(opts.map((x) => x.itemId))}>
                              Select all
                            </Button>
                            <Button type="button" variant="outline" disabled={busy} onClick={() => setCreateSelectedItemIds([])}>
                              Clear
                            </Button>
                          </div>
                        </div>
                      </details>
                    );
                  })()
                ) : (
                  (() => {
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
                          <Button type="button" variant="outline" disabled={busy} onClick={() => setCreateSelectedItemIds([])}>
                            Clear
                          </Button>
                        </div>
                      </div>
                    );
                  })()
                )}
                {!showNoQtyEmptyCycleCreateWorkspace ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <span className="text-xs font-medium text-slate-600">Period (YYYY-MM)</span>
                      <Input
                        value={periodKey}
                        onChange={(e) => setPeriodKey(e.target.value)}
                        placeholder="2026-04"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-9 w-full font-semibold shadow-sm"
                        disabled={busy}
                        onClick={() => void createNewSheet()}
                      >
                        {busy ? "Working…" : "Create Requirement Sheet"}
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="text-xs text-slate-500">
                  {isNoQty
                    ? "One locked requirement sheet per cycle. Additional demand is added on the next cycle."
                    : "Multiple versions per period are supported (v1, v2, v3…)."}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {noSheetsUi ? null : isNoQty && draftUi ? (
          <div className="rounded-md border border-slate-200/80 bg-slate-50/60 px-2.5 py-1.5">
            <div className="grid gap-1">
              <span className="text-[11px] font-medium text-slate-600">Remarks</span>
              <Input
                className="h-8"
                value={remarks}
                disabled={editingDisabled || !sheet}
                onChange={(e) => {
                  setRemarks(e.target.value);
                  if (!locked) setNeedsRecalc(true);
                }}
                placeholder="Optional"
              />
            </div>
            {!locked && sheet ? (
              <div className="mt-1 text-[11px] text-slate-600">
                {needsRecalc ? (
                  <span className="font-medium text-amber-800">Recalculate before finalize to use latest stock.</span>
                ) : (
                  <span>Recalculate before finalize to snapshot the latest stock.</span>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="pb-2 pt-2">
              <CardTitle className="text-sm">Sheet details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {sheet ? (
                <>
                  <Badge
                    variant={
                      sheet.status === "LOCKED" ? "success" : sheet.status === "CANCELLED" ? "default" : "warning"
                    }
                  >
                    {sheet.status === "LOCKED" ? "Locked" : sheet.status === "CANCELLED" ? "Cancelled" : "Draft"}
                  </Badge>
                  {sheet.status === "DRAFT" ? (
                    <span className="text-xs text-slate-500">Draft = not locked yet, editable</span>
                  ) : sheet.status === "CANCELLED" ? (
                    <span className="text-xs text-slate-500">Cancelled = read-only history</span>
                  ) : (
                    <span className="text-xs text-slate-500">Locked = used for production planning</span>
                  )}
                  <span className="text-xs text-slate-600">
                    {(() => {
                      const cycNo = sheets.find((x) => x.id === sheet.id)?.cycleNo;
                      const prefix =
                        isNoQty && cycNo != null && Number.isFinite(Number(cycNo)) && Number(cycNo) > 0
                          ? `Cycle ${Number(cycNo)} · `
                          : "";
                      return `${prefix}${sheet.periodKey ?? "—"} · v${String(sheet.version ?? 1)}`;
                    })()}
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
              {sheet ? (
                <>
                  {locked && !isNoQty ? (
                    <div className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <div className="font-semibold text-slate-800">Store handoff</div>
                      <ul className="mt-2 space-y-1">
                        <li className="flex items-center gap-2">
                          <Badge variant={existingWorkOrderForSheet ? "success" : "default"}>
                            {existingWorkOrderForSheet ? "WO created" : "WO pending"}
                          </Badge>
                          {existingWorkOrderForSheet ? (
                            <Link
                              to={`${workOrdersFocusHref(Number(sheet.workOrderId))}&source=no_qty_so&salesOrderId=${sheet.salesOrderId}`}
                              className="font-medium text-primary underline underline-offset-4"
                            >
                              {sheet.workOrderId != null ? `WO #${sheet.workOrderId}` : "View work order"}
                            </Link>
                          ) : null}
                        </li>
                      </ul>
                    </div>
                  ) : null}

                  {locked && !isNoQty ? (
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

      {showItemsCard ? (
        <Card
          className={cn("min-w-0 overflow-hidden", isNoQty && "border border-slate-200/90 shadow-none")}
          data-testid="rs-items-card"
        >
          <CardHeader
            className={cn(
              isNoQty ? "space-y-0 p-2.5 py-1.5 md:p-2.5 md:py-1.5" : "pb-2 pt-2",
              rsSectionActions && rsItemsHeaderActionClassName,
            )}
          >
            <div
              className={cn(
                "flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5",
                isNoQty && "items-center",
              )}
              data-testid="rs-items-header-row"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <CardTitle className={cn(isNoQty ? "text-[13px] font-semibold leading-none text-slate-900" : "text-base")}>
                  Items
                </CardTitle>
                {isNoQty && sheetDisplayCycleNo != null && sheetDisplayCycleNo > 0 ? (
                  <span className="rounded border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-violet-950">
                    Cycle {sheetDisplayCycleNo}
                  </span>
                ) : null}
                {isNoQty && sheet ? (
                  <Badge variant={sheet.status === "LOCKED" ? "success" : "warning"}>
                    {sheet.status === "LOCKED" ? "Locked" : "Draft"}
                  </Badge>
                ) : null}
                {isNoQty && noQtyPlanningSummary ? (
                  <span className="text-[11px] text-slate-600">
                    {noQtyPlanningSummary.total} item{noQtyPlanningSummary.total === 1 ? "" : "s"}
                    {noQtyPlanningSummary.shortage > 0
                      ? ` · ${noQtyPlanningSummary.shortage} need production`
                      : noQtyPlanningSummary.idle > 0
                        ? ` · ${noQtyPlanningSummary.idle} no fresh qty`
                        : ""}
                    {noQtyPlanningSummary.needsRecalc ? " · recalculate recommended" : ""}
                  </span>
                ) : null}
              </div>
              {rsWorkbenchActionCluster}
            </div>
          </CardHeader>
          <CardContent id="rs-items" className={cn("min-w-0 p-0", isNoQty ? "p-0 md:p-0" : "sm:p-6 sm:pt-0")}>
            {safeLines.length > 0 || (isNoQty && sheet?.status === "DRAFT" && !editingDisabled) ? (
              <div className={cn(isNoQty ? "px-0 pb-0" : "px-3 pb-3 sm:px-0 sm:pb-0")}>
                {isNoQty && sheet?.status === "DRAFT" && !editingDisabled ? (
                  <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2">
                    <div className="grid min-w-[12rem] flex-1 gap-0.5">
                      <label htmlFor="rs-add-fg-item" className="text-[11px] font-medium text-slate-600">
                        Add FG item to this cycle
                      </label>
                      <select
                        id="rs-add-fg-item"
                        className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
                        value={addDraftItemId}
                        disabled={busy}
                        onChange={(e) => setAddDraftItemId(e.target.value)}
                      >
                        <option value="">Select FG…</option>
                        {fgItemOptionsFromSo(so)
                          .filter((o) => !(sheet?.lines || []).some((l) => Number(l.itemId) === o.itemId))
                          .map((o) => (
                            <option key={o.itemId} value={o.itemId}>
                              {o.itemName}
                            </option>
                          ))}
                      </select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={busy || !addDraftItemId}
                      onClick={() => void addDraftFgItem()}
                    >
                      Add item
                    </Button>
                  </div>
                ) : null}
                {isNoQty && safeLines.length > 0 ? (
                  <RequirementSheetNoQtyGrid
                    lines={safeLines}
                    locked={locked}
                    editingDisabled={editingDisabled}
                    needsRecalc={needsRecalc}
                    sheetDisplayCycleNo={sheetDisplayCycleNo}
                    rsCycleSummaries={rsCycleSummaries}
                    recoveryDecisions={sheet?.recoveryDecisions?.items ?? []}
                    canWaive={(RS_WRITE_ROLES as readonly string[]).includes(
                      String(viewerRole ?? "").toUpperCase(),
                    )}
                    onLineChange={(itemId, value) => {
                      setSheet((prev) =>
                        prev
                          ? {
                              ...prev,
                              lines: prev.lines.map((x) =>
                                x.itemId === itemId ? { ...x, newWoQty: value, requirementQty: value } : x,
                              ),
                            }
                          : prev,
                      );
                      if (!locked) setNeedsRecalc(true);
                    }}
                    onLineBlur={() => {
                      if (!locked) setNeedsRecalc(true);
                    }}
                    onKeepRecovery={async (itemId) => {
                      if (!sheet?.id) return;
                      try {
                        await apiFetch(`/api/requirement-sheets/${sheet.id}/recovery-decisions/${itemId}/keep`, {
                          method: "POST",
                          body: JSON.stringify({}),
                        });
                        const next = await apiFetch<SheetDetail>(`/api/requirement-sheets/${sheet.id}`);
                        setSheet(next);
                        setNeedsRecalc(false);
                      } catch (e) {
                        window.alert(e instanceof Error ? e.message : "Failed to Keep recovery.");
                      }
                    }}
                    onWaiveRecovery={async (itemId, reason) => {
                      if (!sheet?.id) return;
                      try {
                        await apiFetch(`/api/requirement-sheets/${sheet.id}/recovery-decisions/${itemId}/waive`, {
                          method: "POST",
                          body: JSON.stringify({ reason }),
                        });
                        const next = await apiFetch<SheetDetail>(`/api/requirement-sheets/${sheet.id}`);
                        setSheet(next);
                        setNeedsRecalc(false);
                      } catch (e) {
                        window.alert(e instanceof Error ? e.message : "Failed to Waive recovery.");
                      }
                    }}
                    onReverseRecoveryDecision={async (itemId) => {
                      if (!sheet?.id) return;
                      try {
                        await apiFetch(`/api/requirement-sheets/${sheet.id}/recovery-decisions/${itemId}/reverse`, {
                          method: "POST",
                          body: JSON.stringify({}),
                        });
                        const next = await apiFetch<SheetDetail>(`/api/requirement-sheets/${sheet.id}`);
                        setSheet(next);
                        setNeedsRecalc(false);
                      } catch (e) {
                        window.alert(e instanceof Error ? e.message : "Failed to reverse recovery decision.");
                      }
                    }}
                    onRemoveItem={
                      sheet?.status === "DRAFT" && !editingDisabled
                        ? (itemId) => removeDraftFgItem(itemId)
                        : undefined
                    }
                  />
                ) : !isNoQty && safeLines.length > 0 ? (
                  <div className="min-w-0 overflow-x-auto">
                    <table className="w-full min-w-[900px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                          <th className="px-4 py-2">Item</th>
                          <th className="px-4 py-2 text-right">Last shortage qty</th>
                          <th className="px-4 py-2 text-right">New requirement qty</th>
                          <th className="px-4 py-2 text-right bg-slate-50">Suggested WO qty</th>
                          <th className="px-4 py-2 text-right">Usable for dispatch (info)</th>
                          <th className="px-4 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {safeLines.map((l) => {
                          const shortfall = safeNum(l.shortfallQty);
                          const rawNewWo = String(l.newWoQty ?? l.requirementQty ?? "");
                          const newWo = !locked && (rawNewWo === "" || rawNewWo === "0" || Number(rawNewWo) === 0) ? "" : rawNewWo;
                          const stock = usableDisplayStock(l.freeSurplusUsableQty ?? l.availableStockQty);
                          const totalUsable = usableDisplayStock(l.totalUsableQty);
                          const reservedActive = usableDisplayStock(l.reservedForActiveNoQtyDispatchQty);
                          const fmtPlan = (n: number) => n.toFixed(3).replace(/\.000$/, "");
                          const newReqNum = safeNum(rawNewWo);
                          const suggestedNet = locked
                            ? safeNum(l.suggestedWoQty)
                            : isNoQty
                              ? computeDraftProductionRequired(l, true)
                              : computeSystemSuggestedNet(newReqNum, stock);
                          const effectiveDemand = shortfall + newReqNum;
                          const noProduction = Math.abs(suggestedNet) <= 1e-6;
                          const status =
                            effectiveDemand <= 1e-6
                              ? { kind: "neutral" as const, label: "Awaiting requirement" }
                              : noProduction && stock + 1e-6 >= effectiveDemand
                                ? { kind: "covered" as const, label: "Covered by stock" }
                                : suggestedNet > 0
                                  ? { kind: "required" as const, label: "WO required" }
                                  : { kind: "neutral" as const, label: "—" };

                          return (
                            <tr key={l.itemId} className="border-b border-slate-100 align-middle">
                              <td className="px-4 py-2">
                                <div className="font-medium text-slate-900">{l.itemName}</div>
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-800">{fmtPlan(shortfall)}</td>
                              <td className="px-4 py-2 text-right">
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
                                  onBlur={() => {
                                    if (!locked) setNeedsRecalc(true);
                                  }}
                                />
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900 bg-slate-50">{fmtPlan(suggestedNet)}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                                <div className="font-medium">{fmtPlan(stock)}</div>
                                {isNoQty ? (
                                  <div className="mt-0.5 text-[11px] text-slate-500">
                                    Total {fmtPlan(totalUsable)} · Reserved (pending cycle dispatch) {fmtPlan(reservedActive)}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-600">{status.label}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="px-3 py-4 text-sm text-slate-600 sm:px-6">
                Loading items…
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {showNoQtyExecutionWorkspace && sheet ? (
        <div id="rs-execution-workspace">
          <RequirementSheetExecutionPanel
            sheetId={sheet.id}
            salesOrderId={sheet.salesOrderId}
            canPlaceWoBatch={canOpenRs}
            priorCycleExecution={priorCycleExecutionContext}
            className="w-full"
          />
        </div>
      ) : null}

      {sheet && !showNoQtyEmptyCycleCreateWorkspace ? (
        <WorkbenchInfoPanels
          panels={[
            {
              key: "history",
              title: "History",
              children: (
                <ActivityHistoryCard
                  title=""
                  density="compact"
                  query={`entityType=REQUIREMENT_SHEET&entityId=${sheet.id}&limit=50`}
                />
              ),
            },
            ...(isNoQty
              ? [
                  {
                    key: "coverage",
                    title: "Coverage",
                    children: (
                      <NoQtyRsCycleSummaryPanel entries={rsCycleSummaries} loading={rsCycleSummaryLoading} />
                    ),
                  },
                  ...(sheet && noQtyFlowState && !showNoQtyLockedRsContextPanel
                    ? [
                        {
                          key: "next-cycle",
                          title: "Next cycle status",
                          children: (
                            <NoQtyNextRsStatusPanel
                              salesOrderId={sheet.salesOrderId}
                              cycleId={
                                noQtyFlowState.cycleId ??
                                (sheet.cycleId != null ? Number(sheet.cycleId) : null) ??
                                activePlanningCycleId ??
                                null
                              }
                              fromStep="requirement"
                              eligibility={{
                                eligible: noQtyFlowState.createNextRsEligible,
                                reason:
                                  noQtyFlowState.createNextRsBlockReason ?? noQtyFlowState.blockedReasons?.[0] ?? null,
                                blockingPmrDocNo: noQtyFlowState.createNextRsBlockingPmrDocNo ?? null,
                                existingNextRsDocNo: noQtyFlowState.nextRsAlreadyCreatedDocNo,
                                nextCycleNo: nextCycleNoForRs,
                              }}
                              showCreateAction={false}
                            />
                          ),
                        },
                      ]
                    : []),
                ]
              : [
                  {
                    key: "help",
                    title: "Column & shortage help",
                    children: (
                      <div className="space-y-1 text-[12px] text-slate-700">
                        <p>
                          <span className="font-medium text-slate-800">Last shortage qty</span>: Pending shortage from previous cycles.
                        </p>
                        <p>
                          <span className="font-medium text-slate-800">Suggested WO qty</span> = New requirement − Usable stock (when positive).
                        </p>
                      </div>
                    ),
                  },
                ]),
          ]}
        />
      ) : null}
          </WorkbenchMain>
        </WorkbenchShell>
      </RequirementSheetErrorBoundary>
    </PageContainer>
  );
}
