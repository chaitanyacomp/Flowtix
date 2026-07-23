import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";
import {
  classifyProductionWorkbenchState,
  type ProductionWorkbenchState,
} from "./productionWorkbenchState";

export type ProductionWorkspaceBucketFilter = "readyToStart" | "inProgress";

export function parseProductionWorkspaceBucket(
  raw: string | null | undefined,
): ProductionWorkspaceBucketFilter | null {
  const v = String(raw ?? "").trim();
  if (v === "readyToStart" || v === "inProgress") return v;
  return null;
}

function statesForBucket(bucket: ProductionWorkspaceBucketFilter): ProductionWorkbenchState[] {
  if (bucket === "readyToStart") return ["READY_TO_START"];
  return ["CONTINUE_PRODUCTION"];
}

export function matchesProductionWorkspaceBucket(
  row: DashboardProductionStatusSource,
  bucket: ProductionWorkspaceBucketFilter | null | undefined,
): boolean {
  if (!bucket) return true;
  const state = classifyProductionWorkbenchState(row);
  // Blocking drafts are never Ready or Continue — they own Draft Awaiting Approval.
  if (state === "DRAFT_PENDING") return false;
  if (bucket === "readyToStart") return state === "READY_TO_START";
  return statesForBucket(bucket).includes(state);
}

export const PRODUCTION_WORKSPACE_BUCKET_LABELS: Record<ProductionWorkspaceBucketFilter, string> = {
  readyToStart: "Ready to Start",
  inProgress: "Continue Production",
};
