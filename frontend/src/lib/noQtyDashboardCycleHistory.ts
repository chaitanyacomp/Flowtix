import { ROW_NUM_EPS } from "./dispatchBacklog";
import { formatWorkspaceQty } from "./workOrderWorkspacePresentation";

export type NoQtyDashboardCycleHistoryStatus =
  | "COMPLETED"
  | "CLOSED"
  | "PLANNING PENDING"
  | "IN PROCESS"
  | string;

export type NoQtyDashboardCycleHistoryRow = {
  cycleNo: number;
  cycleId: number;
  rsLabel: string;
  plannedQty: number;
  producedQty: number;
  shortageQty: number;
  carryForwardAddedQty: number;
  statusLabel: NoQtyDashboardCycleHistoryStatus;
};

export type NoQtyDashboardCycleHistoryPayload = {
  salesOrderId: number;
  cycles?: Array<{ cycleId: number; cycleNo: number; status?: string | null }>;
  currentCycle?: { cycleId: number | null; cycleNo: number | null } | null;
  currentCycleId: number | null;
  currentCycleNo: number | null;
  planningPointerCycleId?: number | null;
  planningPointerCycleNo?: number | null;
  documentCycleId?: number | null;
  documentCycleNo?: number | null;
  noQtyPlanningPointerAhead?: boolean;
  rows: NoQtyDashboardCycleHistoryRow[];
};

/** Show numeric zero explicitly — dashes only when value is missing/invalid. */
export function formatNoQtyDashboardHistoryQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v) <= ROW_NUM_EPS) return "0";
  return formatWorkspaceQty(v);
}

export function isNoQtyHistoryCurrentCycleRow(
  row: NoQtyDashboardCycleHistoryRow,
  payload: Pick<NoQtyDashboardCycleHistoryPayload, "currentCycleId" | "currentCycleNo">,
): boolean {
  if (payload.currentCycleId != null && Number(row.cycleId) === Number(payload.currentCycleId)) return true;
  if (
    payload.currentCycleNo != null &&
    Number.isFinite(Number(payload.currentCycleNo)) &&
    Number(row.cycleNo) === Number(payload.currentCycleNo)
  ) {
    return true;
  }
  return false;
}
