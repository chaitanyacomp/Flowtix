/** REGULAR work order lifecycle — labels and helpers (UI only). */

export const WO_HOLD_REASONS = [
  { value: "RM_SHORTAGE", label: "RM shortage" },
  { value: "MACHINE_BREAKDOWN", label: "Machine breakdown" },
  { value: "PRIORITY_SHIFT", label: "Priority shift" },
  { value: "CUSTOMER_HOLD", label: "Customer hold" },
  { value: "MANAGEMENT_HOLD", label: "Management hold" },
  { value: "OTHER", label: "Other" },
] as const;

export const WO_PRODUCTION_PAUSE_REASON = "PRODUCTION_PAUSE" as const;

export type WoHoldReason = (typeof WO_HOLD_REASONS)[number]["value"] | typeof WO_PRODUCTION_PAUSE_REASON;

export type WorkOrderLifecycleFields = {
  status?: string | null;
  holdReason?: string | null;
  holdRemarks?: string | null;
  heldAt?: string | null;
  shortfallQty?: number | string | null;
  closureReason?: string | null;
  closedAt?: string | null;
};

export function isRegularWorkOrderRow(wo: { cycleId?: number | null; requirementSheetId?: number | null }): boolean {
  return (wo.requirementSheetId == null || wo.requirementSheetId === undefined) && true;
}

export function holdReasonLabel(reason: string | null | undefined): string {
  if (reason === WO_PRODUCTION_PAUSE_REASON) return "Production pause";
  const r = WO_HOLD_REASONS.find((x) => x.value === reason);
  return r?.label ?? (reason ? reason.replace(/_/g, " ") : "On hold");
}

export function isWorkOrderPausedStatus(status: string | null | undefined): boolean {
  return String(status ?? "").toUpperCase() === "PAUSED";
}

export function workOrderStatusDisplayLabel(wo: WorkOrderLifecycleFields): string {
  const st = String(wo.status ?? "").toUpperCase();
  if (st === "PAUSED") return "Paused";
  if (st === "HOLD") return `On hold — ${holdReasonLabel(wo.holdReason)}`;
  if (st === "CLOSED_WITH_SHORTFALL") return "Shortfall closed";
  if (st === "COMPLETED") return "Completed";
  if (st === "IN_PROGRESS") return "In progress";
  if (st === "PENDING") return "Pending";
  if (st === "REJECTED") return "Rejected";
  return st.replace(/_/g, " ");
}

export function workOrderStatusBadgeVariant(
  status: string,
): "default" | "success" | "warning" | "rejected" | "info" {
  const st = String(status).toUpperCase();
  if (st === "PAUSED") return "warning";
  if (st === "HOLD") return "warning";
  if (st === "CLOSED_WITH_SHORTFALL") return "info";
  if (st === "COMPLETED") return "success";
  if (st === "REJECTED") return "rejected";
  if (st === "IN_PROGRESS") return "info";
  return "default";
}

export function canHoldWorkOrder(status: string): boolean {
  const st = String(status).toUpperCase();
  return st === "PENDING" || st === "IN_PROGRESS";
}

export function canResumeWorkOrder(status: string): boolean {
  const st = String(status).toUpperCase();
  return st === "HOLD" || st === "PAUSED";
}

export function canCloseWorkOrderShortfall(status: string): boolean {
  const st = String(status).toUpperCase();
  return st === "PENDING" || st === "IN_PROGRESS" || st === "HOLD" || st === "PAUSED";
}

/** REGULAR production create/approve — only PENDING and IN_PROGRESS. */
export function isWorkOrderProductionBlocked(status: string | null | undefined): boolean {
  const st = String(status ?? "").toUpperCase();
  return st === "HOLD" || st === "PAUSED" || st === "CLOSED_WITH_SHORTFALL" || st === "COMPLETED" || st === "REJECTED";
}

export function workOrderProductionBlockedMessage(wo: WorkOrderLifecycleFields): string | null {
  const st = String(wo.status ?? "").toUpperCase();
  if (st === "PAUSED") {
    return "Accepted FG stock is kept in store. Production can be resumed later.";
  }
  if (st === "HOLD") {
    return `Work order is on hold (${holdReasonLabel(wo.holdReason)}). Resume before recording production.`;
  }
  if (st === "CLOSED_WITH_SHORTFALL") {
    return "Work order is closed with shortfall. No further production is allowed.";
  }
  if (st === "COMPLETED") return "Work order is completed. No further production is allowed.";
  if (st === "REJECTED") return "Work order is rejected.";
  return null;
}

export async function resumeWorkOrderApi(workOrderId: number): Promise<void> {
  const { apiFetch } = await import("../services/api");
  await apiFetch(`/api/production/work-orders/${workOrderId}/resume`, { method: "POST" });
}

export async function pauseWorkOrderProductionApi(workOrderId: number, remarks?: string | null): Promise<void> {
  const { apiFetch } = await import("../services/api");
  await apiFetch(`/api/production/work-orders/${workOrderId}/hold`, {
    method: "POST",
    body: JSON.stringify({ holdReason: WO_PRODUCTION_PAUSE_REASON, remarks: remarks ?? null }),
  });
}
