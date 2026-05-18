import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";
import { operationalStatusFromProductionRow } from "./dashboardProductionStatus";

const EPS = 1e-6;

/** Presentation-only lifecycle for Requirement & Cycle Planning rows (does not change RS/WO math). */
export type PlanningLifecyclePhase =
  | "NEEDS_WO"
  | "WO_CREATED"
  | "READY_FOR_PRODUCTION"
  | "IN_PRODUCTION"
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
  CARRY_FORWARD_PENDING: 4,
  CARRIED_FORWARD: 4,
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
    case "CARRY_FORWARD_PENDING":
      return "Next Cycle";
    case "CARRIED_FORWARD":
      return "Carried Forward";
    case "PRODUCTION_DONE":
      return "Production Done";
    case "QC_PENDING":
      return "QC Pending";
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
  if (phase === "IN_PRODUCTION" || phase === "QC_PENDING") return "info";
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

  if (next === "QC_PENDING" || row.hasPendingQc) return "QC_PENDING";
  if (next === "DISPATCH_PENDING" || next === "SALES_BILL_PENDING") return "QC_DONE";
  if (woStatus === "COMPLETED" && balance <= EPS) return "QC_DONE";

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
  if (produced <= EPS && (woStatus === "IN_PROGRESS" || woStatus === "PENDING" || next === "PRODUCTION_PENDING")) {
    return "READY_FOR_PRODUCTION";
  }
  return "WO_CREATED";
}

type WoLifecycleSource = {
  status: string;
  salesOrderId: number;
  lines: Array<{
    fgItemId: number;
    approvedProducedQty?: number;
    remainingQty?: number;
  }>;
};

export function planningPhaseFromWorkOrder(wo: WoLifecycleSource): PlanningLifecyclePhase {
  const woStatus = String(wo.status ?? "").toUpperCase();
  if (woStatus === "COMPLETED") return "QC_DONE";

  let best: PlanningLifecyclePhase = "WO_CREATED";
  for (const line of wo.lines ?? []) {
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
