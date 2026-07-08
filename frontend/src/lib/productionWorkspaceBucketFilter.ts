import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";
import {
  isQueueInProgress,
  isQueueReadyToStart,
} from "./productionWorkspaceReadinessUx";

export type ProductionWorkspaceBucketFilter = "readyToStart" | "inProgress";

export function parseProductionWorkspaceBucket(
  raw: string | null | undefined,
): ProductionWorkspaceBucketFilter | null {
  const v = String(raw ?? "").trim();
  if (v === "readyToStart" || v === "inProgress") return v;
  return null;
}

export function matchesProductionWorkspaceBucket(
  row: DashboardProductionStatusSource,
  bucket: ProductionWorkspaceBucketFilter | null | undefined,
): boolean {
  if (!bucket) return true;

  if (bucket === "readyToStart") {
    return isQueueReadyToStart(row);
  }

  return isQueueInProgress(row);
}

export const PRODUCTION_WORKSPACE_BUCKET_LABELS: Record<ProductionWorkspaceBucketFilter, string> = {
  readyToStart: "Ready to start",
  inProgress: "In progress",
};
