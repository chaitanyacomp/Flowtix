/**
 * Active shift-run guidance helpers (mirrors backend activeShiftRunGuidanceService).
 */

export const ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS = {
  CONFIRM_MACHINE_START: "Confirm Machine Start",
  RECORD_PRODUCTION: "Record Production",
} as const;

export const OPEN_ACTIVE_SHIFT_LABEL = "Open Active Shift";

export type ActiveShiftRunGuidance = {
  shiftSessionId: number;
  shiftSessionNo?: string | null;
  runSegmentId: number;
  segmentNo?: number;
  machineId: number;
  machineCode?: string | null;
  machineName?: string | null;
  shiftId?: number | null;
  shiftCode?: string | null;
  shiftName?: string | null;
  workOrderId: number;
  workOrderNo?: string | null;
  workOrderLineId?: number | null;
  runAllocationId?: number | null;
  operatorId?: number | null;
  operatorName?: string | null;
  operatorCode?: string | null;
  segmentStartedAt?: string | null;
  runningMs?: number;
  runningTimeLabel?: string | null;
  startConfirmationStatus?: string | null;
  confirmationPending?: boolean;
  primaryActionLabel: string;
  secondaryActionLabel?: string;
  workspaceHref?: string;
  pendingActionsHref?: string;
  shiftSessionHref?: string;
};

export function isActiveShiftRunPrimaryAction(label: unknown): boolean {
  const t = String(label ?? "").trim();
  return (
    t === ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START ||
    t === ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION
  );
}

export function workbenchPrimaryActionLabelForActiveShift(
  guidance: Pick<ActiveShiftRunGuidance, "primaryActionLabel" | "confirmationPending"> | null | undefined,
  fallback: string,
): string {
  if (!guidance) return fallback;
  const label = String(guidance.primaryActionLabel ?? "").trim();
  if (isActiveShiftRunPrimaryAction(label)) return label;
  if (guidance.confirmationPending) return ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START;
  return ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION;
}

export function formatActiveShiftRunningTime(
  startedAtIso: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!startedAtIso) return "—";
  const started = new Date(startedAtIso).getTime();
  if (!Number.isFinite(started)) return "—";
  const totalSec = Math.max(0, Math.floor((nowMs - started) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Distinct active shift runs from production-queue rows (one per session/segment). */
export function pickActiveShiftRunsFromQueue<T extends { activeShiftRun?: ActiveShiftRunGuidance | null }>(
  rows: T[] | null | undefined,
): ActiveShiftRunGuidance[] {
  if (!rows?.length) return [];
  const seen = new Set<string>();
  const out: ActiveShiftRunGuidance[] = [];
  for (const row of rows) {
    const g = row.activeShiftRun;
    if (!g || !(Number(g.shiftSessionId) > 0) || !(Number(g.runSegmentId) > 0)) continue;
    const key = `${g.shiftSessionId}:${g.runSegmentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

function isStartConfirmationPending(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toUpperCase() !== "CONFIRMED";
}

export function resolveActiveShiftRunPrimaryAction(input: {
  startConfirmationStatus?: string | null;
  runAllocationId?: number | null;
  requiresStartConfirmation?: boolean;
}): string {
  const runAllocationId = Number(input.runAllocationId ?? 0);
  const requires =
    input.requiresStartConfirmation != null
      ? Boolean(input.requiresStartConfirmation)
      : runAllocationId > 0;
  if (requires && isStartConfirmationPending(input.startConfirmationStatus)) {
    return ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START;
  }
  return ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION;
}

/** Deep-link into Production Workspace with active shift + run context (does not start a new segment). */
export function buildActiveShiftRunWorkspaceHref(
  input: {
    workOrderId?: number | null;
    workOrderLineId?: number | null;
    runAllocationId?: number | null;
    shiftSessionId?: number | null;
    sessionId?: number | null;
    runSegmentId?: number | null;
    machineId?: number | null;
    salesOrderId?: number | null;
    cycleId?: number | null;
    orderType?: string | null;
    primaryActionLabel?: string | null;
    startConfirmationStatus?: string | null;
    requiresStartConfirmation?: boolean;
  },
  from = "dashboard",
): string {
  const params = new URLSearchParams();
  if (from) {
    params.set("from", from);
    if (from === "pending-actions") params.set("returnTo", "pending-actions");
  }
  const workOrderId = Number(input.workOrderId ?? 0);
  if (workOrderId > 0) params.set("workOrderId", String(workOrderId));
  const workOrderLineId = Number(input.workOrderLineId ?? 0);
  if (workOrderLineId > 0) params.set("workOrderLineId", String(workOrderLineId));
  const runAllocationId = Number(input.runAllocationId ?? 0);
  if (runAllocationId > 0) params.set("runAllocationId", String(runAllocationId));
  const shiftSessionId = Number(input.shiftSessionId ?? input.sessionId ?? 0);
  if (shiftSessionId > 0) params.set("shiftSessionId", String(shiftSessionId));
  const runSegmentId = Number(input.runSegmentId ?? 0);
  if (runSegmentId > 0) params.set("runSegmentId", String(runSegmentId));
  const machineId = Number(input.machineId ?? 0);
  if (machineId > 0) params.set("machineId", String(machineId));
  const salesOrderId = Number(input.salesOrderId ?? 0);
  if (salesOrderId > 0) params.set("salesOrderId", String(salesOrderId));
  const cycleId = Number(input.cycleId ?? 0);
  if (cycleId > 0) params.set("cycleId", String(cycleId));
  const orderType = String(input.orderType ?? "").trim().toUpperCase();
  if (orderType) params.set("flow", orderType === "GREEN_LEVEL" ? "GREEN_LEVEL" : orderType);

  params.set("pwSection", "active");
  params.set("productionBucket", "inProgress");

  const primary =
    String(input.primaryActionLabel ?? "").trim() ||
    resolveActiveShiftRunPrimaryAction({
      startConfirmationStatus: input.startConfirmationStatus,
      runAllocationId,
      requiresStartConfirmation: input.requiresStartConfirmation,
    });
  if (primary === ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START) {
    params.set("focusConfirmStart", "1");
  } else {
    params.set("focusRecordProduction", "1");
  }

  return `/production?${params.toString()}`;
}
