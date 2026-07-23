import { ROW_NUM_EPS } from "./dispatchBacklog";
import { NO_QTY_TERMS } from "./flowTerminology";
import { isGreenLevelReplenishmentSourceType } from "./productionFlowContract";
import { workOrderHrefForOpenWo } from "./operationalWorkspaceLinks";
import { holdReasonLabel } from "./workOrderLifecycle";
import {
  noQtyErpAdjustedPlanningQty,
  noQtyOperatorPendingQtyFromRow,
} from "./noQtyShortagePresentation";
import { mapQueueReadinessToOperationalPresentation } from "./workOrderReadinessUx";
import { canAcceptNewProductionEntry } from "./productionActiveEligibility";

/** Minimal production-queue row shape for dashboard live status (from /api/dashboard/production-queue). */
export type DashboardProductionStatusSource = {
  productionWorkState?: "READY_TO_START" | "CONTINUE_PRODUCTION" | "PAUSED_PRODUCTION" | null;
  hasOpenDraft?: boolean;
  openDraftProductionId?: number | null;
  itemCode?: string | null;
  /** Reserved for the future machine-assignment read model; never inferred client-side. */
  machineLabel?: string | null;
  workOrderId: number;
  workOrderNo: string;
  workOrderLineId?: number;
  itemId?: number;
  salesOrderId?: number;
  salesOrderNo?: string;
  customerName?: string;
  itemName: string;
  requiredQty: number;
  producedQty: number;
  balanceQty: number;
  /** FG item UOM from Item Master (production-queue API). */
  itemUnit?: string | null;
  status?: string;
  holdReason?: string | null;
  productionExecutionStatus?: string | null;
  productionReportConfirmed?: boolean;
  productionReportId?: number | null;
  productionReportConfirmedAt?: string | null;
  regularClosurePending?: boolean;
  regularShortfallQty?: number;
  productionBlockReason?: string | null;
  productionBlockReasonLabel?: string | null;
  productionBlockRemarks?: string | null;
  orderType?: string | null;
  sourceType?: string | null;
  nextAction?: string | null;
  hasPendingQc?: boolean;
  pendingQcEntryCount?: number;
  pendingQcQty?: number;
  dispatchableQty?: number;
  /** NO_QTY carry-forward shortfall keyed to planning pointer (informational). */
  lastShortageQty?: number;
  actionHref?: string;
  cycleId?: number | null;
  cycleNo?: number | null;
  /** Phase 3C — REGULAR only; from production-queue API */
  rmReadinessGate?: string | null;
  rmProductionAllowedNowQty?: number | null;
  rmReadyForProduction?: boolean | null;
  /** Backend-owned CTA label from production-queue (`deriveProductionQueueActionLabel`). */
  actionLabel?: string | null;
  /**
   * Backend canonical flag: WO line may accept a new production entry.
   * When omitted, frontend `assessProductionEntryEligibility` derives the same rule.
   */
  canAcceptProductionEntry?: boolean | null;
  /** Backend Live Factory bucket (shared classifier). */
  liveFactoryBucket?: string | null;
  /** Pause / block timestamp when WO is PAUSED or execution BLOCKED. */
  pausedAt?: string | null;
  /** WO createdAt ISO — age / last activity fallback. */
  workOrderDate?: string | null;
};

export type ProductionOperationalStatusTone =
  | "ready"
  | "running"
  | "paused"
  | "qc"
  | "partial"
  | "carryForward"
  | "carriedForward"
  | "dispatch"
  | "idle";

export type ProductionOperationalStatus = {
  label: string;
  tone: ProductionOperationalStatusTone;
  /** Optional subline under status badge (NO_QTY carry-forward context). */
  contextHint?: string;
};

export type DashboardProductionStatusRow = DashboardProductionStatusSource & {
  flowLabel: string;
  operationalStatus: ProductionOperationalStatus;
  remainingQty: number;
  /** Operator pending qty (planned − produced) for Planned / Prod / Pending display. */
  shortageQty: number;
  /** Carry-forward planning qty (`lastShortageQty`) from prior planned qty minus approved produced qty. */
  erpAdjustedPlanningQty: number;
  progressPct: number;
  showProgressBar: boolean;
  /**
   * Broader operator-actionable flag (Work Order Workspace sectioning, Next Cycle, etc.).
   * False when shortage already moved to a later WO / shortfall closed.
   */
  countsAsActive: boolean;
  /**
   * Production Workspace Active Production only — true when the WO can accept a new production entry.
   * Never derived from plannedQty − producedQty alone.
   */
  countsAsActiveProduction: boolean;
  sortRank: number;
};

export type DashboardProductionStatusBuild = {
  /** Current operational rows for display, newest WO first. Historical carry-forward rows are counted but not shown. */
  visible: DashboardProductionStatusRow[];
  /** All enriched queue lines (including historical / carried-forward). Used by Work Order Workspace sectioning. */
  all: DashboardProductionStatusRow[];
  /** Lines that still need operator action. */
  activeCount: number;
  /** Distinct WOs with at least one actionable line. */
  activeWorkOrderCount: number;
  /** Lines where shortage already moved to a later RS/WO. */
  carriedForwardCount: number;
  /** All queue lines after enrichment. */
  totalInQueue: number;
  /** @deprecated Use activeCount — kept for callers expecting `total`. */
  total: number;
};

type NoQtyPeer = { workOrderId: number; cycleNo: number };

export type NoQtyCarryContext = {
  bySoItem: Map<string, NoQtyPeer[]>;
};

function flowLabelFromOrderType(orderType?: string | null, sourceType?: string | null): string {
  if (orderType === "NO_QTY") return NO_QTY_TERMS.AGREEMENT_LABEL;
  if (orderType === "GREEN_LEVEL" || isGreenLevelReplenishmentSourceType(sourceType)) return "GREEN_LEVEL";
  return "REGULAR Order";
}

function isNoQtyOrder(orderType?: string | null): boolean {
  return orderType === "NO_QTY";
}

function isGreenLevelProductionRow(row: Pick<DashboardProductionStatusSource, "orderType" | "sourceType">): boolean {
  return row.orderType === "GREEN_LEVEL" || isGreenLevelReplenishmentSourceType(row.sourceType);
}

function soItemKey(row: DashboardProductionStatusSource): string | null {
  const soId = Number(row.salesOrderId ?? 0);
  const itemId = Number(row.itemId ?? 0);
  if (!(soId > 0) || !(itemId > 0)) return null;
  return `${soId}:${itemId}`;
}

/** Build cross-row index used only to corroborate an explicit finalized carry-forward. */
export function buildNoQtyCarryContext(rows: DashboardProductionStatusSource[]): NoQtyCarryContext {
  const bySoItem = new Map<string, NoQtyPeer[]>();
  for (const r of rows) {
    if (!isNoQtyOrder(r.orderType)) continue;
    const key = soItemKey(r);
    if (!key) continue;
    const list = bySoItem.get(key) ?? [];
    list.push({ workOrderId: r.workOrderId, cycleNo: Number(r.cycleNo ?? 0) });
    bySoItem.set(key, list);
  }
  return { bySoItem };
}

/** A same-cycle sibling WO is never carry-forward evidence. */
export function noQtyShortageAbsorbedByLaterRow(
  row: DashboardProductionStatusSource,
  ctx: NoQtyCarryContext | null | undefined,
): boolean {
  if (!ctx) return false;
  const key = soItemKey(row);
  if (!key) return false;
  const peers = ctx.bySoItem.get(key);
  if (!peers || peers.length < 2) return false;
  const myWo = row.workOrderId;
  const myCycle = Number(row.cycleNo ?? 0);
  const exec = String(row.productionExecutionStatus ?? "").trim().toUpperCase();
  const next = String(row.nextAction ?? "").trim().toUpperCase();
  const woStatus = String(row.status ?? "").trim().toUpperCase();
  const hasExplicitFinalShortfall =
    woStatus === "CLOSED_WITH_SHORTFALL" ||
    (exec === "COMPLETED" && next === "NEXT_RS_REQUIRED");
  if (!hasExplicitFinalShortfall || myCycle <= 0) return false;
  return peers.some((p) => {
    if (p.workOrderId === myWo) return false;
    return p.cycleNo > myCycle;
  });
}

/** Line-level operator pending qty (planned − produced). */
export function lineShortageQty(row: DashboardProductionStatusSource): number {
  return noQtyOperatorPendingQtyFromRow(row);
}

export type ProductionHrefRoute =
  | "dispatch"
  | "requirement"
  | "production"
  | "qc"
  | "sales_bill"
  | "work_orders"
  | "unknown";

/** Presentation-only: infer primary click destination from dashboard actionHref. */
export function inferProductionHrefRoute(href?: string | null): ProductionHrefRoute {
  const h = String(href ?? "").toLowerCase();
  if (!h) return "unknown";
  if (h.includes("/dispatch")) return "dispatch";
  if (h.includes("/requirement-sheets") || h.includes("intent=add")) return "requirement";
  if (h.includes("/qc-entry")) return "qc";
  if (h.includes("/sales-bills")) return "sales_bill";
  if (h.includes("/work-orders")) return "work_orders";
  if (h.includes("/production")) return "production";
  return "unknown";
}

/** Fallback href when API row omits actionHref (tests / legacy payloads). */
function syntheticNoQtyActionHref(row: DashboardProductionStatusSource): string | undefined {
  if (row.actionHref) return row.actionHref;
  const next = String(row.nextAction ?? "").toUpperCase();
  const sid = Number(row.salesOrderId ?? 0);
  if (!(sid > 0)) return undefined;
  const cyc =
    row.cycleId != null && Number.isFinite(Number(row.cycleId)) && Number(row.cycleId) > 0
      ? `&cycleId=${encodeURIComponent(String(row.cycleId))}`
      : "";
  const noQtyBase = `flow=NO_QTY&source=no_qty_so&salesOrderId=${encodeURIComponent(String(sid))}${cyc}`;
  if (next === "QC_PENDING") return `/qc-entry?${noQtyBase}`;
  if (next === "DISPATCH_PENDING") return `/dispatch?${noQtyBase}`;
  if (next === "SALES_BILL_PENDING") return `/sales-bills?${noQtyBase}`;
  if (next === "NEXT_RS_REQUIRED") {
    return `/sales-orders/${encodeURIComponent(String(sid))}/requirement-sheets?intent=add&${noQtyBase}&from=dashboard_shortage`;
  }
  if (next === "PRODUCTION_PENDING") return `/production?${noQtyBase}`;
  return `/production?${noQtyBase}`;
}

function effectiveProductionHref(row: DashboardProductionStatusSource): string | undefined {
  if (isNoQtyOrder(row.orderType)) return syntheticNoQtyActionHref(row);
  return row.actionHref ?? undefined;
}

/**
 * REGULAR flow — prefer backend productionWorkState / nextAction + RM readiness (M1.6).
 * Qty/href may refine presentation only when nextAction is absent.
 * Ready-to-start is never classified as Running.
 */
function operationalStatusFromRegularRow(row: DashboardProductionStatusSource): ProductionOperationalStatus {
  const workState = String(row.productionWorkState ?? "").trim().toUpperCase();
  const producedEarly = Number(row.producedQty ?? 0);
  const remainingEarly = Math.max(0, Number(row.balanceQty ?? 0));
  const woStatusEarly = String(row.status ?? "").toUpperCase();
  const execEarly = String(row.productionExecutionStatus ?? "").toUpperCase();

  if (execEarly === "BLOCKED" || workState === "PAUSED_PRODUCTION" || woStatusEarly === "PAUSED") {
    if (execEarly === "BLOCKED") {
      const mapped = mapQueueReadinessToOperationalPresentation(row);
      return { label: mapped.label || "Blocked", tone: mapped.tone === "idle" ? "partial" : mapped.tone };
    }
    return { label: "Paused", tone: "paused" };
  }
  if (workState === "DRAFT_PENDING" || row.hasOpenDraft || String(row.nextAction ?? "").toUpperCase() === "PRODUCTION_DRAFT_REVIEW") {
    return { label: "Draft Pending", tone: "partial" };
  }
  if (workState === "READY_TO_START") {
    return { label: "Ready to Start", tone: "ready" };
  }
  if (workState === "CONTINUE_PRODUCTION") {
    return {
      label: producedEarly > ROW_NUM_EPS && remainingEarly > ROW_NUM_EPS ? "Continue" : "Running",
      tone: "running",
    };
  }

  const next = String(row.nextAction ?? "").trim().toUpperCase();
  if (next) {
    // REGULAR does not use Next Cycle framing — keep historical Partially Produced for NEXT_RS.
    if (next === "NEXT_RS_REQUIRED") {
      return { label: "Partially Produced", tone: "partial" };
    }
    // Entry QC with executable remaining balance → Continue (not QA-in-progress for the whole WO).
    if (
      (row.hasPendingQc || next === "QC_PENDING") &&
      remainingEarly > ROW_NUM_EPS &&
      (next === "PRODUCTION_PENDING" || next === "PRODUCTION_DRAFT_REVIEW" || producedEarly > ROW_NUM_EPS)
    ) {
      return { label: "Continue", tone: "running" };
    }
    const mapped = mapQueueReadinessToOperationalPresentation(row);
    if (
      (mapped.label === "QA in progress" || mapped.label === "QC Pending") &&
      remainingEarly > ROW_NUM_EPS &&
      producedEarly > ROW_NUM_EPS
    ) {
      return { label: "Continue", tone: "running" };
    }
    // Preserve prior REGULAR nuance: READY_FOR_PRODUCTION gate with zero produced → Partial RM at Production
    if (
      mapped.label === "Ready for Production" &&
      row.rmReadinessGate === "READY_FOR_PRODUCTION" &&
      Number(row.producedQty ?? 0) <= ROW_NUM_EPS &&
      row.rmReadyForProduction !== true
    ) {
      return { label: "Partial RM at Production", tone: "partial", contextHint: mapped.contextHint };
    }
    if (mapped.label === "Ready for Production" || mapped.label === "Ready to Start") {
      return { label: "Ready to Start", tone: "ready", contextHint: mapped.contextHint };
    }
    if (mapped.label === "Waiting for Production") {
      return { label: "Waiting for Production", tone: "ready", contextHint: mapped.contextHint };
    }
    return { label: mapped.label, tone: mapped.tone, contextHint: mapped.contextHint };
  }

  const produced = Number(row.producedQty ?? 0);
  const remaining = Math.max(0, Number(row.balanceQty ?? 0));
  const dispatchable = Number(row.dispatchableQty ?? 0);
  const route = inferProductionHrefRoute(row.actionHref);
  const gate = row.rmReadinessGate ?? null;
  const rmReady = row.rmReadyForProduction === true;
  const woStatus = String(row.status ?? "").toUpperCase();

  if (woStatus === "HOLD") {
    return {
      label: holdReasonLabel(row.holdReason) === "On hold" ? "On Hold" : `On Hold - ${holdReasonLabel(row.holdReason)}`,
      tone: "paused",
    };
  }
  if (woStatus === "CLOSED_WITH_SHORTFALL") {
    return { label: "Shortfall Closed", tone: "idle" };
  }
  if (gate === "NO_PMR" || gate === "PMR_DRAFT_ONLY") {
    return { label: "Waiting for Material", tone: "partial" };
  }
  if (gate === "WAITING_STORE_ISSUE") {
    return { label: "Waiting for RM issue", tone: "partial" };
  }
  if (gate === "READY_FOR_PRODUCTION" && produced <= ROW_NUM_EPS && !rmReady) {
    return { label: "Partial RM at Production", tone: "partial" };
  }
  if (gate != null && !rmReady && produced <= ROW_NUM_EPS) {
    return { label: "Waiting for Production", tone: "ready" };
  }
  // Entry QC must not replace WO execution status when remaining capacity is executable.
  if (row.hasPendingQc && remaining <= ROW_NUM_EPS) {
    return { label: "QC Pending", tone: "qc" };
  }
  if (dispatchable > ROW_NUM_EPS && route === "dispatch") {
    return { label: "Waiting Dispatch", tone: "dispatch" };
  }
  if (produced > ROW_NUM_EPS && remaining > ROW_NUM_EPS) {
    return { label: "Continue", tone: "running" };
  }
  if (produced <= ROW_NUM_EPS) {
    const canStart =
      gate == null
        ? woStatus === "IN_PROGRESS" || woStatus === "PENDING"
        : gate === "READY_FOR_PRODUCTION" && rmReady;
    return { label: canStart ? "Ready to Start" : "Waiting for Production", tone: "ready" };
  }
  if (woStatus === "IN_PROGRESS" || woStatus === "PENDING") {
    return { label: "Running", tone: "running" };
  }
  if (remaining <= ROW_NUM_EPS) {
    return { label: "Completed", tone: "idle" };
  }
  return { label: "Production Pending", tone: "partial" };
}

/** NO_QTY flow — backend nextAction first; carry-forward peer detection is presentation grouping only. */
function operationalStatusFromNoQtyRow(
  row: DashboardProductionStatusSource,
  ctx: NoQtyCarryContext | null | undefined,
): ProductionOperationalStatus {
  const produced = Number(row.producedQty ?? 0);
  const remaining = Math.max(0, Number(row.balanceQty ?? 0));
  const next = String(row.nextAction ?? "").trim().toUpperCase();
  const woStatus = String(row.status ?? "").toUpperCase();
  const shortage = lineShortageQty(row);
  const absorbed = noQtyShortageAbsorbedByLaterRow(row, ctx);
  const route = inferProductionHrefRoute(effectiveProductionHref(row));

  if (row.productionExecutionStatus === "BLOCKED" || next === "PRODUCTION_EXECUTION_BLOCKED") {
    const mapped = mapQueueReadinessToOperationalPresentation(row);
    return { label: mapped.label, tone: mapped.tone };
  }

  if (woStatus === "HOLD" || next === "ON_HOLD") {
    const mapped = mapQueueReadinessToOperationalPresentation(row);
    return { label: mapped.label, tone: mapped.tone };
  }
  if (woStatus === "CLOSED_WITH_SHORTFALL") {
    return { label: "Shortfall Closed", tone: "idle" };
  }

  const execStatus = String(row.productionExecutionStatus ?? "").toUpperCase();

  // Finalized shortfall / later-WO absorption is terminal for production even when QC remains.
  if (produced > ROW_NUM_EPS && (remaining > ROW_NUM_EPS || execStatus === "COMPLETED") && absorbed) {
    return {
      label: "Carried Forward",
      tone: "carriedForward",
      contextHint: "Shortage moved to next RS/WO",
    };
  }

  if (execStatus === "COMPLETED") {
    if (next === "QC_PENDING" || row.hasPendingQc || route === "qc") {
      return { label: "QC Pending", tone: "qc" };
    }
    return { label: "Production Complete", tone: "idle" };
  }

  // Entry-level QC with remaining balance → Continue (not WO-level QC Pending).
  if ((next === "QC_PENDING" || row.hasPendingQc || route === "qc") && remaining <= ROW_NUM_EPS) {
    return { label: "QC Pending", tone: "qc" };
  }
  if (row.hasPendingQc && remaining > ROW_NUM_EPS && produced > ROW_NUM_EPS) {
    return { label: "Continue", tone: "running" };
  }

  if (next) {
    const mapped = mapQueueReadinessToOperationalPresentation(row);
    if (mapped.label === "Next Cycle") {
      return { label: "Next Cycle", tone: "carryForward" };
    }
    return { label: mapped.label, tone: mapped.tone, contextHint: mapped.contextHint };
  }

  if (route === "requirement") {
    return { label: "Next Cycle", tone: "carryForward" };
  }

  if (route === "dispatch") {
    return { label: "Dispatch Pending", tone: "dispatch" };
  }

  if (route === "sales_bill") {
    return { label: "Ready to Bill", tone: "dispatch" };
  }

  if (remaining <= ROW_NUM_EPS) {
    return { label: "Production Complete", tone: "idle" };
  }

  if (route === "work_orders") {
    return { label: "Work Order", tone: "running" };
  }

  if (route === "production") {
    if (produced > ROW_NUM_EPS && remaining > ROW_NUM_EPS) {
      return { label: "Continue Production", tone: "running" };
    }
    if (produced <= ROW_NUM_EPS) {
      if (woStatus === "IN_PROGRESS" || woStatus === "PENDING") {
        return { label: "Ready to Start", tone: "ready" };
      }
      return { label: "Waiting for Production", tone: "ready" };
    }
    return { label: "In Production", tone: "running" };
  }

  if (produced > ROW_NUM_EPS && remaining > ROW_NUM_EPS) {
    if (shortage > ROW_NUM_EPS) {
      return { label: "Next Cycle", tone: "carryForward" };
    }
    return { label: "In Production", tone: "running" };
  }

  if (produced <= ROW_NUM_EPS) {
    if (woStatus === "IN_PROGRESS" || woStatus === "PENDING") {
      return { label: "Ready to Start", tone: "ready" };
    }
    return { label: "Waiting for Production", tone: "ready" };
  }

  return { label: "Production Pending", tone: "partial" };
}

/** Green Level — prefer backend nextAction / execution block fields (M1.6). */
function operationalStatusFromGreenLevelRow(row: DashboardProductionStatusSource): ProductionOperationalStatus {
  const next = String(row.nextAction ?? "").trim().toUpperCase();
  if (next || row.productionExecutionStatus) {
    const mapped = mapQueueReadinessToOperationalPresentation({ ...row, orderType: "GREEN_LEVEL" });
    return { label: mapped.label, tone: mapped.tone, contextHint: mapped.contextHint };
  }

  const produced = Number(row.producedQty ?? 0);
  const remaining = Math.max(0, Number(row.balanceQty ?? 0));
  const woStatus = String(row.status ?? "").toUpperCase();
  if (woStatus === "CLOSED_WITH_SHORTFALL") {
    return { label: "Shortfall Closed", tone: "idle" };
  }
  if (row.hasPendingQc && remaining <= ROW_NUM_EPS) {
    return { label: "QC Pending", tone: "qc" };
  }
  if (produced > ROW_NUM_EPS && remaining > ROW_NUM_EPS) {
    return { label: "Continue", tone: "running" };
  }
  if (produced <= ROW_NUM_EPS) {
    if (woStatus === "IN_PROGRESS" || woStatus === "PENDING") {
      return { label: "Ready to Start", tone: "ready" };
    }
    return { label: "Waiting for Production", tone: "ready" };
  }
  if (remaining <= ROW_NUM_EPS) {
    return { label: "Production Complete", tone: "idle" };
  }
  return { label: "In Production", tone: "running" };
}

/** Map production-queue snapshot to operator-facing live status (presentation only). */
export function operationalStatusFromProductionRow(
  row: DashboardProductionStatusSource,
  allRows?: DashboardProductionStatusSource[],
): ProductionOperationalStatus {
  if (isNoQtyOrder(row.orderType)) {
    const ctx = allRows?.length ? buildNoQtyCarryContext(allRows) : null;
    return operationalStatusFromNoQtyRow(row, ctx);
  }
  if (isGreenLevelProductionRow(row)) {
    return operationalStatusFromGreenLevelRow(row);
  }
  return operationalStatusFromRegularRow(row);
}

export function productionStatusShowsProgressBar(tone: ProductionOperationalStatusTone): boolean {
  return tone !== "carryForward" && tone !== "carriedForward";
}

/** Broader actionable flag for Work Order Workspace (not Active Production eligibility). */
export function productionStatusCountsAsActive(status: ProductionOperationalStatus): boolean {
  if (status.label === "Carried Forward" || status.label === "Shortfall Closed") return false;
  return true;
}

function sortRankForRow(row: DashboardProductionStatusRow): number {
  const toneRank: Record<ProductionOperationalStatusTone, number> = {
    qc: 0,
    paused: 1,
    running: 2,
    ready: 3,
    partial: 4,
    carryForward: 4,
    dispatch: 5,
    idle: 6,
    carriedForward: 7,
  };
  return toneRank[row.operationalStatus.tone] ?? 8;
}

function compareRowsForDisplay(a: DashboardProductionStatusRow, b: DashboardProductionStatusRow): number {
  if (b.workOrderId !== a.workOrderId) return b.workOrderId - a.workOrderId;
  if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
  return b.remainingQty - a.remainingQty;
}

export function buildDashboardProductionStatusRows(
  rows: DashboardProductionStatusSource[],
  { limit = 8 }: { limit?: number } = {},
): DashboardProductionStatusBuild {
  const noQtyCtx = buildNoQtyCarryContext(rows);

  const enriched = rows.map((r) => {
    const required = Math.max(0, Number(r.requiredQty ?? 0));
    const produced = Math.max(0, Number(r.producedQty ?? 0));
    const remaining = Math.max(0, Number(r.balanceQty ?? 0));
    const operationalStatus = isNoQtyOrder(r.orderType)
      ? operationalStatusFromNoQtyRow(r, noQtyCtx)
      : isGreenLevelProductionRow(r)
        ? operationalStatusFromGreenLevelRow(r)
        : operationalStatusFromRegularRow(r);
    const shortageQty =
      isNoQtyOrder(r.orderType) || isGreenLevelProductionRow(r) ? noQtyOperatorPendingQtyFromRow(r) : 0;
    const erpAdjustedPlanningQty = isNoQtyOrder(r.orderType) ? noQtyErpAdjustedPlanningQty(r) : 0;
    const hideProgress =
      operationalStatus.tone === "carryForward" || operationalStatus.tone === "carriedForward";
    const progressPct = hideProgress
      ? 0
      : required > ROW_NUM_EPS
        ? Math.min(100, Math.round((produced / required) * 100))
        : produced > 0
          ? 100
          : 0;
    let actionHref = r.actionHref;
    if (
      isNoQtyOrder(r.orderType) &&
      operationalStatus.label === "Carried Forward" &&
      r.workOrderId > 0
    ) {
      actionHref = workOrderHrefForOpenWo({
        orderType: r.orderType,
        salesOrderId: r.salesOrderId,
        workOrderId: r.workOrderId,
        cycleId: r.cycleId ?? null,
      });
    }

    const rowEnriched: DashboardProductionStatusRow = {
      ...r,
      actionHref,
      flowLabel: flowLabelFromOrderType(r.orderType, r.sourceType),
      operationalStatus,
      remainingQty: remaining,
      shortageQty,
      erpAdjustedPlanningQty,
      progressPct,
      showProgressBar: productionStatusShowsProgressBar(operationalStatus.tone),
      countsAsActive: productionStatusCountsAsActive(operationalStatus),
      countsAsActiveProduction: canAcceptNewProductionEntry({
        ...r,
        absorbedByLaterWo: isNoQtyOrder(r.orderType) ? noQtyShortageAbsorbedByLaterRow(r, noQtyCtx) : false,
      }),
      sortRank: 0,
    };
    rowEnriched.sortRank = sortRankForRow(rowEnriched);
    return rowEnriched;
  });

  const activeProduction = enriched.filter((r) => r.countsAsActiveProduction);
  const carriedForward = enriched.filter((r) => r.operationalStatus.label === "Carried Forward");
  const activeWorkOrderCount = new Set(activeProduction.map((r) => r.workOrderId)).size;

  const displaySorted = [...activeProduction].sort(compareRowsForDisplay);

  const activeCount = activeProduction.length;
  return {
    /** Active Production list — only WOs that can accept a new production entry. */
    visible: displaySorted.slice(0, limit),
    all: enriched,
    activeCount,
    activeWorkOrderCount,
    carriedForwardCount: carriedForward.length,
    totalInQueue: enriched.length,
    total: activeCount,
  };
}

/** KPI / attention summary from production queue (presentation only). */
export function summarizeDashboardProductionAttention(rows: DashboardProductionStatusSource[]): {
  activeLineCount: number;
  activeWorkOrderCount: number;
  carriedForwardLineCount: number;
  totalLineCount: number;
} {
  const built = buildDashboardProductionStatusRows(rows, { limit: Math.max(rows.length, 1) });
  return {
    activeLineCount: built.activeCount,
    activeWorkOrderCount: built.activeWorkOrderCount,
    carriedForwardLineCount: built.carriedForwardCount,
    totalLineCount: built.totalInQueue,
  };
}

export { formatProductionQty, formatFgQuantity } from "./quantityDisplay";

/** True when row should show Planned / Prod / Pending (NO_QTY operator qty). */
export function productionStatusUsesPendingColumn(
  row: Pick<DashboardProductionStatusRow, "orderType" | "sourceType">,
): boolean {
  return isNoQtyOrder(row.orderType) || isGreenLevelProductionRow(row);
}

/** @deprecated Use productionStatusUsesPendingColumn */
export const productionStatusUsesShortageColumn = productionStatusUsesPendingColumn;
