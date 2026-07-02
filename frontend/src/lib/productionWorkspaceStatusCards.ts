import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";

export type ProductionWorkspaceStatusBucket =
  | "readyToStart"
  | "waitingRmReturn"
  | "shortfallDecision"
  | "pendingQa";

export type ProductionWorkspaceStatusCounts = Record<ProductionWorkspaceStatusBucket, number>;

export type RmReturnPendingRow = {
  workOrderId: number;
  workOrderNo?: string;
};

const EPS = 1e-6;

export function classifyProductionQueueBucket(row: DashboardProductionStatusSource): ProductionWorkspaceStatusBucket | null {
  const next = String(row.nextAction ?? "").trim().toUpperCase();
  const exec = String(row.productionExecutionStatus ?? "").trim().toUpperCase();

  if (next === "QC_PENDING" || row.hasPendingQc) return "pendingQa";
  if (next === "PRODUCTION_SHORTFALL_DECISION" || exec === "SHORTFALL_PENDING") return "shortfallDecision";
  if (
    next === "PRODUCTION_PENDING" &&
    Number(row.producedQty ?? 0) <= EPS &&
    exec !== "BLOCKED"
  ) {
    return "readyToStart";
  }
  return null;
}

export function buildProductionWorkspaceStatusCounts(
  queueRows: DashboardProductionStatusSource[],
  rmReturnPending: RmReturnPendingRow[],
): ProductionWorkspaceStatusCounts {
  const woReady = new Set<number>();
  const woShortfall = new Set<number>();
  const woQa = new Set<number>();
  const woRmReturn = new Set<number>();

  for (const row of queueRows) {
    const woId = Number(row.workOrderId ?? 0);
    if (!(woId > 0)) continue;
    const bucket = classifyProductionQueueBucket(row);
    if (bucket === "readyToStart") woReady.add(woId);
    if (bucket === "shortfallDecision") woShortfall.add(woId);
    if (bucket === "pendingQa") woQa.add(woId);
  }

  for (const row of rmReturnPending) {
    if (row.workOrderId > 0) woRmReturn.add(row.workOrderId);
  }

  return {
    readyToStart: woReady.size,
    waitingRmReturn: woRmReturn.size,
    shortfallDecision: woShortfall.size,
    pendingQa: woQa.size,
  };
}

export const PRODUCTION_STATUS_CARD_LABELS: Record<ProductionWorkspaceStatusBucket, string> = {
  readyToStart: "Ready to Start",
  waitingRmReturn: "Pending Store Tasks",
  shortfallDecision: "Ready for Shortfall Decision",
  pendingQa: "Pending QA",
};
