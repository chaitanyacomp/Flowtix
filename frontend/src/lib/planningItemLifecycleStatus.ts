import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";
import { operationalStatusFromProductionRow } from "./dashboardProductionStatus";

const EPS = 1e-6;

/** Presentation-only lifecycle for Requirement & Cycle Planning rows (does not change RS/WO math). */
export type PlanningLifecyclePhase =
  | "NEEDS_WO"
  | "WO_CREATED"
  | "READY_FOR_PRODUCTION"
  | "IN_PRODUCTION"
  | "ON_HOLD"
  | "SHORTFALL_CLOSED"
  | "CARRY_FORWARD_PENDING"
  | "CARRIED_FORWARD"
  | "PRODUCTION_DONE"
  | "QC_PENDING"
  | "QC_DONE";

const PHASE_RANK: Record<PlanningLifecyclePhase, number> = {
  NEEDS_WO: 0,
  WO_CREATED: 1,
  READY_FOR_PRODUCTION: 2,
  IN_PRODUCTION: 3,
  ON_HOLD: 3,
  CARRY_FORWARD_PENDING: 4,
  CARRIED_FORWARD: 4,
  SHORTFALL_CLOSED: 5,
  PRODUCTION_DONE: 5,
  QC_PENDING: 6,
  QC_DONE: 7,
};

export function mergePlanningLifecyclePhase(a: PlanningLifecyclePhase, b: PlanningLifecyclePhase): PlanningLifecyclePhase {
  return PHASE_RANK[a] >= PHASE_RANK[b] ? a : b;
}

export function planningLifecycleLabel(phase: PlanningLifecyclePhase): string {
  switch (phase) {
    case "NEEDS_WO":
      return "Planning Required";
    case "WO_CREATED":
      return "WO Created";
    case "READY_FOR_PRODUCTION":
      return "Ready for Production";
    case "IN_PRODUCTION":
      return "In Production";
    case "ON_HOLD":
      return "On Hold";
    case "SHORTFALL_CLOSED":
      return "Shortfall Closed";
    case "CARRY_FORWARD_PENDING":
      return "Next Cycle";
    case "CARRIED_FORWARD":
      return "Carried Forward";
    case "PRODUCTION_DONE":
      return "Production Done";
    case "QC_PENDING":
      return "QA in progress";
    case "QC_DONE":
      return "QC Done";
    default:
      return "Planning Required";
  }
}

export function planningLifecycleBadgeVariant(
  phase: PlanningLifecyclePhase,
): "rejected" | "warning" | "success" | "info" | "default" {
  if (phase === "NEEDS_WO") return "rejected";
  if (phase === "WO_CREATED" || phase === "READY_FOR_PRODUCTION") return "warning";
  if (phase === "IN_PRODUCTION" || phase === "QC_PENDING" || phase === "ON_HOLD") return "info";
  if (phase === "SHORTFALL_CLOSED") return "default";
  if (phase === "CARRY_FORWARD_PENDING" || phase === "CARRIED_FORWARD") return "warning";
  if (phase === "PRODUCTION_DONE" || phase === "QC_DONE") return "success";
  return "default";
}

function normalizeCustomer(name: string | null | undefined): string {
  const t = String(name ?? "").trim();
  return t || "—";
}

export function orderWisePlanningKey(itemId: number, customerName: string): string {
  return `${itemId}:${normalizeCustomer(customerName)}`;
}

export function planningPhaseFromProductionQueueRow(
  row: DashboardProductionStatusSource & { itemId?: number },
  allQueueRows?: DashboardProductionStatusSource[],
): PlanningLifecyclePhase {
  const next = String(row.nextAction ?? "").toUpperCase();
  const produced = Number(row.producedQty ?? 0);
  const balance = Number(row.balanceQty ?? 0);
  const woStatus = String(row.status ?? "").toUpperCase();
  const hasPendingQc = Boolean(row.hasPendingQc);

  if (woStatus === "HOLD") return "ON_HOLD";
  if (woStatus === "CLOSED_WITH_SHORTFALL") return hasPendingQc ? "QC_PENDING" : "SHORTFALL_CLOSED";

  if (next === "QC_PENDING" || hasPendingQc) return "QC_PENDING";
  if (next === "DISPATCH_PENDING" || next === "SALES_BILL_PENDING") return "QC_DONE";
  // WO `status === COMPLETED` is driven by approved production qty alone (see
  // backend `syncWorkOrderStatusFromProduction`). Treat as QC_DONE only when no
  // batch on this row still has QC pending — otherwise the correct label is
  // "QC Pending" (covered above) or "Production Done" (handled below).
  if (woStatus === "COMPLETED" && balance <= EPS && !hasPendingQc) return "QC_DONE";

  const op = operationalStatusFromProductionRow(row, allQueueRows);
  if (
    op.label === "Completed" ||
    op.label === "Production Complete" ||
    op.label === "Waiting Dispatch" ||
    op.label === "Dispatch Pending" ||
    op.label === "Ready to Bill"
  ) {
    return "QC_DONE";
  }
  if (op.label === "QC Pending") return "QC_PENDING";
  if (op.label === "Carry-forward Pending" || op.label === "Next Cycle") return "CARRY_FORWARD_PENDING";
  if (op.label === "Carried Forward") return "CARRIED_FORWARD";

  if (produced > EPS && balance <= EPS) return "PRODUCTION_DONE";
  if (produced > EPS && balance > EPS) return "IN_PRODUCTION";
  if (produced <= EPS && op.label === "Ready for Production") {
    return "READY_FOR_PRODUCTION";
  }
  return "WO_CREATED";
}

type WoLifecycleSource = {
  status: string;
  holdReason?: string | null;
  salesOrderId: number;
  lines: Array<{
    fgItemId: number;
    approvedProducedQty?: number;
    remainingQty?: number;
    /**
     * Per-line aggregated pending QC qty (production-approved but not finalized by QC).
     * Sourced from the WO list API; required to distinguish "Production Done" from
     * "QC Pending" when the WO status flips to COMPLETED on approved production qty alone.
     */
    qcPendingQty?: number;
    hasPendingQc?: boolean;
  }>;
};

export function planningPhaseFromWorkOrder(wo: WoLifecycleSource): PlanningLifecyclePhase {
  const woStatus = String(wo.status ?? "").toUpperCase();
  const lines = wo.lines ?? [];
  const anyLineHasPendingQc = lines.some(
    (l) => Boolean(l.hasPendingQc) || Number(l.qcPendingQty ?? 0) > EPS,
  );
  if (woStatus === "CLOSED_WITH_SHORTFALL") {
    return anyLineHasPendingQc ? "QC_PENDING" : "SHORTFALL_CLOSED";
  }
  if (woStatus === "HOLD") {
    return anyLineHasPendingQc ? "QC_PENDING" : "ON_HOLD";
  }

  // WO `status === COMPLETED` is set from approved production qty alone (backend
  // `syncWorkOrderStatusFromProduction`). It does not imply QC is done — only that
  // the shop floor has nothing more to produce on this WO. Promote to QC_DONE only
  // when every line has cleared QC; otherwise surface QC_PENDING.
  if (woStatus === "COMPLETED") {
    return anyLineHasPendingQc ? "QC_PENDING" : "QC_DONE";
  }
  if (anyLineHasPendingQc) return "QC_PENDING";

  let best: PlanningLifecyclePhase = "WO_CREATED";
  for (const line of lines) {
    const produced = Number(line.approvedProducedQty ?? 0);
    const remaining = Number(line.remainingQty ?? NaN);
    const rem = Number.isFinite(remaining) ? remaining : NaN;

    if (produced > EPS && Number.isFinite(rem) && rem <= EPS) {
      best = mergePlanningLifecyclePhase(best, "PRODUCTION_DONE");
      continue;
    }
    if (produced > EPS) {
      best = mergePlanningLifecyclePhase(best, "IN_PRODUCTION");
      continue;
    }
    if (woStatus === "IN_PROGRESS" || woStatus === "PENDING") {
      best = mergePlanningLifecyclePhase(best, "READY_FOR_PRODUCTION");
    }
  }
  return best;
}

export type PlanningLifecycleIndex = {
  byOrderKey: Map<string, PlanningLifecyclePhase>;
  byItemId: Map<number, PlanningLifecyclePhase>;
};

export function buildPlanningLifecycleIndex(input: {
  queueRows: Array<DashboardProductionStatusSource & { itemId?: number }>;
  workOrders: WoLifecycleSource[];
  customerNameBySalesOrderId: Map<number, string>;
}): PlanningLifecycleIndex {
  const byOrderKey = new Map<string, PlanningLifecyclePhase>();
  const byItemId = new Map<number, PlanningLifecyclePhase>();

  const apply = (itemId: number, customerName: string | undefined, phase: PlanningLifecyclePhase) => {
    const orderKey = orderWisePlanningKey(itemId, customerName ?? "—");
    byOrderKey.set(orderKey, mergePlanningLifecyclePhase(byOrderKey.get(orderKey) ?? "NEEDS_WO", phase));
    byItemId.set(itemId, mergePlanningLifecyclePhase(byItemId.get(itemId) ?? "NEEDS_WO", phase));
  };

  for (const row of input.queueRows) {
    const itemId = Number((row as { itemId?: number }).itemId ?? 0);
    if (!(itemId > 0)) continue;
    apply(itemId, row.customerName, planningPhaseFromProductionQueueRow(row, input.queueRows));
  }

  for (const wo of input.workOrders) {
    const customer = input.customerNameBySalesOrderId.get(wo.salesOrderId) ?? "—";
    const phase = planningPhaseFromWorkOrder(wo);
    for (const line of wo.lines ?? []) {
      if (!(line.fgItemId > 0)) continue;
      apply(line.fgItemId, customer, phase);
    }
  }

  return { byOrderKey, byItemId };
}

export function resolveOrderWisePlanningPhase(
  index: PlanningLifecycleIndex,
  itemId: number,
  customerName: string,
): PlanningLifecyclePhase {
  return index.byOrderKey.get(orderWisePlanningKey(itemId, customerName)) ?? "NEEDS_WO";
}

export function resolveProductWisePlanningPhase(index: PlanningLifecycleIndex, itemId: number): PlanningLifecyclePhase {
  return index.byItemId.get(itemId) ?? "NEEDS_WO";
}

export function planningItemNeedsWo(phase: PlanningLifecyclePhase): boolean {
  return phase === "NEEDS_WO";
}
