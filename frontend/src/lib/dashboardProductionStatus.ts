import { ROW_NUM_EPS } from "./dispatchBacklog";
import { NO_QTY_TERMS } from "./flowTerminology";
import { workOrderHrefForOpenWo } from "./operationalWorkspaceLinks";
import { holdReasonLabel } from "./workOrderLifecycle";
import {
  noQtyErpAdjustedPlanningQty,
  noQtyOperatorPendingQtyFromRow,
} from "./noQtyShortagePresentation";

/** Minimal production-queue row shape for dashboard live status (from /api/dashboard/production-queue). */
export type DashboardProductionStatusSource = {
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
  status?: string;
  holdReason?: string | null;
  orderType?: string | null;
  nextAction?: string | null;
  hasPendingQc?: boolean;
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
};

export type ProductionOperationalStatusTone =
  | "running"
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
  /** False when no operator action remains (e.g. shortage already on a later WO). */
  countsAsActive: boolean;
  sortRank: number;
};

export type DashboardProductionStatusBuild = {
  /** Current operational rows for display, newest WO first. Historical carry-forward rows are counted but not shown. */
  visible: DashboardProductionStatusRow[];
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

function flowLabelFromOrderType(orderType?: string | null): string {
  return orderType === "NO_QTY" ? NO_QTY_TERMS.AGREEMENT_LABEL : "REGULAR Order";
}

function isNoQtyOrder(orderType?: string | null): boolean {
  return orderType === "NO_QTY";
}

function soItemKey(row: DashboardProductionStatusSource): string | null {
  const soId = Number(row.salesOrderId ?? 0);
  const itemId = Number(row.itemId ?? 0);
  if (!(soId > 0) || !(itemId > 0)) return null;
  return `${soId}:${itemId}`;
}

/** Build cross-row index to detect later cycle / WO for the same SO line. */
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

/** True when a later WO or higher cycle exists for this SO+item (shortage moved forward). */
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
  return peers.some((p) => {
    if (p.workOrderId === myWo) return false;
    if (p.workOrderId > myWo) return true;
    return myCycle > 0 && p.cycleNo > myCycle;
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
  const noQtyBase = `source=no_qty_so&salesOrderId=${encodeURIComponent(String(sid))}${cyc}`;
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

/** REGULAR flow — production status respects Phase 3C PMR/MIN readiness when present. */
function operationalStatusFromRegularRow(row: DashboardProductionStatusSource): ProductionOperationalStatus {
  const produced = Number(row.producedQty ?? 0);
  const remaining = Math.max(0, Number(row.balanceQty ?? 0));
  const dispatchable = Number(row.dispatchableQty ?? 0);
  const next = String(row.nextAction ?? "").toUpperCase();
  const route = inferProductionHrefRoute(row.actionHref);
  const gate = row.rmReadinessGate ?? null;
  const rmReady = row.rmReadyForProduction === true;
  const woStatus = String(row.status ?? "").toUpperCase();

  if (woStatus === "HOLD" || next === "ON_HOLD") {
    return {
      label: holdReasonLabel(row.holdReason) === "On hold" ? "On Hold" : `On Hold - ${holdReasonLabel(row.holdReason)}`,
      tone: "partial",
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
  if (gate === "PARTIAL_READY" && produced <= ROW_NUM_EPS) {
    return { label: "Partial RM at Production", tone: "partial" };
  }
  if (gate != null && !rmReady && produced <= ROW_NUM_EPS) {
    return { label: "Waiting for Production", tone: "running" };
  }

  if (next === "QC_PENDING" || row.hasPendingQc) {
    return { label: "QA in progress", tone: "qc" };
  }
  if (next === "DISPATCH_PENDING" || (dispatchable > ROW_NUM_EPS && route === "dispatch")) {
    return { label: "Waiting Dispatch", tone: "dispatch" };
  }
  if (next === "SALES_BILL_PENDING") {
    return { label: "Ready to Bill", tone: "dispatch" };
  }
  if (produced > ROW_NUM_EPS && remaining > ROW_NUM_EPS) {
    if (gate === "WAITING_STORE_ISSUE" || gate === "NO_PMR" || gate === "PMR_DRAFT_ONLY") {
      return { label: "Waiting RM", tone: "partial" };
    }
    return { label: "Partially Produced", tone: "partial" };
  }
  if (next === "NEXT_RS_REQUIRED") {
    return { label: "Partially Produced", tone: "partial" };
  }
  if (produced <= ROW_NUM_EPS) {
    const canStart =
      gate == null
        ? woStatus === "IN_PROGRESS" || woStatus === "PENDING" || next === "PRODUCTION_PENDING"
        : gate === "FULLY_ISSUED_READY" && rmReady;
    if (canStart) {
      return { label: "Ready for Production", tone: "running" };
    }
    return { label: "Waiting for Production", tone: "running" };
  }
  if (woStatus === "IN_PROGRESS" || woStatus === "PENDING") {
    return { label: "Running", tone: "running" };
  }
  if (remaining <= ROW_NUM_EPS) {
    return { label: "Completed", tone: "idle" };
  }
  return { label: "Production Pending", tone: "running" };
}

/** NO_QTY flow — route-aligned labels (href must match badge; dispatchableQty alone is not dispatch). */
function operationalStatusFromNoQtyRow(
  row: DashboardProductionStatusSource,
  ctx: NoQtyCarryContext | null | undefined,
): ProductionOperationalStatus {
  const produced = Number(row.producedQty ?? 0);
  const remaining = Math.max(0, Number(row.balanceQty ?? 0));
  const next = String(row.nextAction ?? "").toUpperCase();
  const woStatus = String(row.status ?? "").toUpperCase();
  const shortage = lineShortageQty(row);
  const absorbed = noQtyShortageAbsorbedByLaterRow(row, ctx);
  const route = inferProductionHrefRoute(effectiveProductionHref(row));

  if (woStatus === "HOLD" || next === "ON_HOLD") {
    return {
      label: holdReasonLabel(row.holdReason) === "On hold" ? "On Hold" : `On Hold - ${holdReasonLabel(row.holdReason)}`,
      tone: "partial",
    };
  }
  if (woStatus === "CLOSED_WITH_SHORTFALL") {
    return { label: "Shortfall Closed", tone: "idle" };
  }

  if (next === "QC_PENDING" || row.hasPendingQc || route === "qc") {
    return { label: "QA in progress", tone: "qc" };
  }

  if (produced > ROW_NUM_EPS && remaining > ROW_NUM_EPS && absorbed) {
    return {
      label: "Carried Forward",
      tone: "carriedForward",
      contextHint: "Shortage moved to next RS/WO",
    };
  }

  if (route === "requirement" || next === "NEXT_RS_REQUIRED") {
    return { label: "Next Cycle", tone: "carryForward" };
  }

  if (route === "dispatch" || next === "DISPATCH_PENDING") {
    return { label: "Dispatch Pending", tone: "dispatch" };
  }

  if (next === "SALES_BILL_PENDING" || route === "sales_bill") {
    return { label: "Ready to Bill", tone: "dispatch" };
  }

  if (remaining <= ROW_NUM_EPS) {
    return { label: "Production Complete", tone: "idle" };
  }

  if (route === "work_orders") {
    return { label: "Work Order", tone: "running" };
  }

  if (route === "production" || next === "PRODUCTION_PENDING") {
    if (produced > ROW_NUM_EPS && remaining > ROW_NUM_EPS) {
      return { label: "Continue Production", tone: "running" };
    }
    if (produced <= ROW_NUM_EPS) {
      if (woStatus === "IN_PROGRESS" || woStatus === "PENDING") {
        return { label: "Ready for Production", tone: "running" };
      }
      return { label: "Waiting for Production", tone: "running" };
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
    if (woStatus === "IN_PROGRESS" || woStatus === "PENDING" || next === "PRODUCTION_PENDING") {
      return { label: "Ready for Production", tone: "running" };
    }
    return { label: "Waiting for Production", tone: "running" };
  }

  return { label: "Production Pending", tone: "running" };
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
  return operationalStatusFromRegularRow(row);
}

export function productionStatusShowsProgressBar(tone: ProductionOperationalStatusTone): boolean {
  return tone !== "carryForward" && tone !== "carriedForward";
}

export function productionStatusCountsAsActive(status: ProductionOperationalStatus): boolean {
  if (status.label === "Carried Forward" || status.label === "Shortfall Closed") return false;
  return true;
}

function sortRankForRow(row: DashboardProductionStatusRow): number {
  const toneRank: Record<ProductionOperationalStatusTone, number> = {
    qc: 0,
    running: 1,
    partial: 2,
    carryForward: 2,
    dispatch: 3,
    idle: 4,
    carriedForward: 6,
  };
  return toneRank[row.operationalStatus.tone] ?? 7;
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
      : operationalStatusFromRegularRow(r);
    const shortageQty = isNoQtyOrder(r.orderType) ? noQtyOperatorPendingQtyFromRow(r) : 0;
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
      flowLabel: flowLabelFromOrderType(r.orderType),
      operationalStatus,
      remainingQty: remaining,
      shortageQty,
      erpAdjustedPlanningQty,
      progressPct,
      showProgressBar: productionStatusShowsProgressBar(operationalStatus.tone),
      countsAsActive: productionStatusCountsAsActive(operationalStatus),
      sortRank: 0,
    };
    rowEnriched.sortRank = sortRankForRow(rowEnriched);
    return rowEnriched;
  });

  const active = enriched.filter((r) => r.countsAsActive);
  const carriedForward = enriched.filter((r) => r.operationalStatus.label === "Carried Forward");
  const activeWorkOrderCount = new Set(active.map((r) => r.workOrderId)).size;

  const displaySorted = [...active].sort(compareRowsForDisplay);

  const activeCount = active.length;
  return {
    visible: displaySorted.slice(0, limit),
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

export function formatProductionQty(q: number): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** True when row should show Planned / Prod / Pending (NO_QTY operator qty). */
export function productionStatusUsesPendingColumn(
  row: Pick<DashboardProductionStatusRow, "orderType">,
): boolean {
  return isNoQtyOrder(row.orderType);
}

/** @deprecated Use productionStatusUsesPendingColumn */
export const productionStatusUsesShortageColumn = productionStatusUsesPendingColumn;
