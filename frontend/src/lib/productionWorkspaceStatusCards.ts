import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";
import { classifyProductionQueueBucketFromBackend } from "./productionWorkspaceReadinessUx";

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
    const bucket = classifyProductionQueueBucketFromBackend(row);
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
