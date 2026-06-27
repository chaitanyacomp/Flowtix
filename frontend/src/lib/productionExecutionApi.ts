import { apiFetch } from "../services/api";

export type ProductionExecutionStatus = "RUNNING" | "SHORTFALL_PENDING" | "BLOCKED" | "COMPLETED";

export type ProductionBlockReason =
  | "MACHINE_BREAKDOWN"
  | "WAITING_FOR_RM"
  | "TOOL_MOULD_MAINTENANCE"
  | "QUALITY_CONCERN"
  | "EMERGENCY_PRIORITY_PRODUCTION"
  | "POWER_UTILITY_FAILURE"
  | "MANAGEMENT_HOLD"
  | "OTHER";

export type ProductionResolutionReason =
  | "MACHINE_BREAKDOWN"
  | "CAPACITY_CONSTRAINT"
  | "WAITING_FOR_RM"
  | "TOOL_MAINTENANCE"
  | "CUSTOMER_PRIORITY_CHANGE"
  | "MANAGEMENT_DECISION"
  | "QUALITY_CONCERN"
  | "OTHER";

export type ShortfallFinishOutcome = "BLOCK" | "CARRY_FORWARD" | "WAIVE_BALANCE";

export interface ProductionExecutionSummary {
  workOrderId: number;
  workOrderDocNo?: string | null;
  workOrderStatus: string;
  executionStatus: ProductionExecutionStatus;
  blockReason?: ProductionBlockReason | null;
  blockRemarks?: string | null;
  blockReasonLabel?: string | null;
  plannedQty: number;
  producedQty: number;
  remainderQty: number;
  surplusQty?: number;
  productionPendingQty: number;
  hasShortfall: boolean;
  hasSurplus?: boolean;
  pendingShortfallResolution?: boolean;
  blockReasons: ProductionBlockReason[];
  resolutionReasons: ProductionResolutionReason[];
  lines: Array<{
    workOrderLineId: number;
    fgItemId: number;
    fgItemName?: string | null;
    plannedQty: number;
    producedQty: number;
    remainderQty: number;
    productionPendingQty: number;
  }>;
}

export interface CarryForwardPendingRow {
  id: number;
  itemId: number;
  itemName?: string | null;
  customerId?: number | null;
  customerName?: string | null;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  sourceRequirementSheetId?: number | null;
  sourceRequirementSheetDocNo?: string | null;
  sourceWorkOrderId: number;
  sourceWorkOrderDocNo?: string | null;
  remainingQty: number;
  resolutionReason: ProductionResolutionReason;
  resolutionReasonOther?: string | null;
  remarks?: string | null;
  ageDays: number;
  plannedNextRsHint?: string | null;
  createdAt: string;
}

export function blockReasonDisplayLabel(reason: string): string {
  return reason.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function fetchProductionExecution(workOrderId: number): Promise<ProductionExecutionSummary> {
  return apiFetch(`/api/production/work-orders/${workOrderId}/production-execution`);
}

export async function blockProductionExecutionApi(
  workOrderId: number,
  body: { blockReason: ProductionBlockReason; remarks?: string | null },
) {
  return apiFetch(`/api/production/work-orders/${workOrderId}/production-execution/block`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function resumeProductionExecutionApi(workOrderId: number) {
  return apiFetch(`/api/production/work-orders/${workOrderId}/production-execution/resume`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function finishProductionExecutionApi(
  workOrderId: number,
  body: {
    shortfallOutcome?: ShortfallFinishOutcome;
    blockReason?: ProductionBlockReason;
    resolutionReason?: ProductionResolutionReason;
    remarks?: string | null;
  },
) {
  return apiFetch(`/api/production/work-orders/${workOrderId}/production-execution/finish`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchCarryForwardPending(salesOrderId?: number): Promise<{ rows: CarryForwardPendingRow[] }> {
  const q = salesOrderId != null ? `?salesOrderId=${salesOrderId}` : "";
  return apiFetch(`/api/planning-dashboard/carry-forward-pending${q}`);
}
