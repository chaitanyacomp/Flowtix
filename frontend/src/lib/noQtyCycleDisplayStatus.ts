import {
  buildNoQtyCarryContext,
  noQtyShortageAbsorbedByLaterRow,
  operationalStatusFromProductionRow,
  type DashboardProductionStatusSource,
  type ProductionOperationalStatus,
  type ProductionOperationalStatusTone,
} from "./dashboardProductionStatus";

export type NoQtyCycleDisplayScope = "auto" | "active" | "historical";

export type NoQtyCycleDisplayStatusInput = DashboardProductionStatusSource & {
  allQueueRows?: DashboardProductionStatusSource[];
  /** Raw WO lifecycle from API when queue snapshot is missing. */
  woLifecycleStatus?: string | null;
  scope?: NoQtyCycleDisplayScope;
  /** Viewing a cycle that is not the SO's current operational cycle. */
  isPriorCycle?: boolean;
};

export type NoQtyCycleDisplayStatus = {
  label: string;
  tone: ProductionOperationalStatusTone;
  isHistorical: boolean;
};

const ACTIVE_PRODUCTION_ALIASES = new Set([
  "Continue Production",
  "Ready for Production",
  "Waiting for Production",
  "Production Pending",
  "In Production",
  "Running",
  "Partially Produced",
  "Work Order",
]);

const DISPATCH_ALIASES = new Set(["Dispatch Pending", "Waiting Dispatch", "Ready to Bill"]);

/** Map internal operational labels to operator-facing NO_QTY cycle status wording. */
export function mapOperationalLabelToNoQtyDisplayLabel(operationalLabel: string): string {
  const lb = String(operationalLabel ?? "").trim();
  if (!lb) return "In Progress";
  if (lb === "Next Cycle" || lb === "Carry-forward Pending") return "Next Cycle Pending";
  if (lb === "QC Pending") return "QC Pending";
  if (DISPATCH_ALIASES.has(lb)) return "Waiting Dispatch";
  if (lb === "Carried Forward") return "Carried Forward";
  if (lb === "Production Complete" || lb === "Completed") return "Completed";
  if (lb === "Closed" || lb === "Closed Cycle") return "Closed";
  if (ACTIVE_PRODUCTION_ALIASES.has(lb)) return "In Progress";
  return lb;
}

function isNoQty(orderType?: string | null): boolean {
  return orderType === "NO_QTY";
}

function woLifecycleIsCompleted(woStatus?: string | null): boolean {
  return String(woStatus ?? "").toUpperCase() === "COMPLETED";
}

function inferHistorical(input: {
  operational: ProductionOperationalStatus;
  absorbed: boolean;
  scope: NoQtyCycleDisplayScope;
  isPriorCycle: boolean;
  woLifecycleStatus?: string | null;
}): boolean {
  if (input.scope === "historical") return true;
  if (input.scope === "active") return false;
  if (input.isPriorCycle) return true;
  if (input.absorbed || input.operational.label === "Carried Forward") return true;
  if (input.operational.tone === "idle" && woLifecycleIsCompleted(input.woLifecycleStatus)) return true;
  if (
    input.operational.label === "Production Complete" ||
    input.operational.label === "Completed" ||
    input.operational.label === "Ready to Bill"
  ) {
    return true;
  }
  return false;
}

function historicalOverrideLabel(input: {
  operational: ProductionOperationalStatus;
  absorbed: boolean;
  woLifecycleStatus?: string | null;
}): string | null {
  if (input.absorbed || input.operational.label === "Carried Forward") return "Carried Forward";
  if (woLifecycleIsCompleted(input.woLifecycleStatus)) return "Completed";
  if (input.operational.label === "Production Complete" || input.operational.label === "Completed") {
    return "Completed";
  }
  if (input.operational.label === "Ready to Bill") return "Waiting Dispatch";
  if (input.operational.label === "Next Cycle" || input.operational.label === "Carry-forward Pending") {
    return "Next Cycle Pending";
  }
  return null;
}

/**
 * Single resolver for NO_QTY user-facing cycle workflow status (presentation only).
 * Never surfaces raw WO lifecycle enums (IN_PROGRESS, PENDING, OPEN) to operators.
 */
export function resolveNoQtyCycleDisplayStatus(
  input: NoQtyCycleDisplayStatusInput,
): NoQtyCycleDisplayStatus {
  const allRows = input.allQueueRows;
  const ctx = allRows?.length ? buildNoQtyCarryContext(allRows) : null;
  const absorbed = noQtyShortageAbsorbedByLaterRow(input, ctx);
  const operational = operationalStatusFromProductionRow(input, allRows);
  const scope = input.scope ?? "auto";
  const isPriorCycle = Boolean(input.isPriorCycle);
  const isHistorical = inferHistorical({
    operational,
    absorbed,
    scope,
    isPriorCycle,
    woLifecycleStatus: input.woLifecycleStatus ?? input.status,
  });

  let label: string;
  if (isHistorical) {
    label =
      historicalOverrideLabel({
        operational,
        absorbed,
        woLifecycleStatus: input.woLifecycleStatus ?? input.status,
      }) ?? mapOperationalLabelToNoQtyDisplayLabel(operational.label);
    if (
      isPriorCycle &&
      !absorbed &&
      operational.label !== "Carried Forward" &&
      !woLifecycleIsCompleted(input.woLifecycleStatus ?? input.status) &&
      (String(input.woLifecycleStatus ?? input.status ?? "").toUpperCase() === "IN_PROGRESS" ||
        String(input.woLifecycleStatus ?? input.status ?? "").toUpperCase() === "PENDING")
    ) {
      label = "Carried Forward";
    }
  } else {
    label = mapOperationalLabelToNoQtyDisplayLabel(operational.label);
  }

  let tone = operational.tone;
  if (label === "Carried Forward") tone = "carriedForward";
  else if (label === "Completed" || label === "Closed") tone = "idle";
  else if (label === "QC Pending") tone = "qc";
  else if (label === "Waiting Dispatch") tone = "dispatch";
  else if (label === "Next Cycle Pending") tone = "carryForward";

  return { label, tone, isHistorical };
}

export type NoQtyWorkOrderDisplaySource = {
  id: number;
  status: string;
  salesOrderId: number;
  cycleId?: number | null;
  cycle?: { cycleNo?: number | null; id?: number | null } | null;
  lines?: Array<{
    qty: string;
    approvedProducedQty?: number;
    remainingQty?: number;
    fgItemId?: number;
  }>;
};

function sumWoLineQty(lines: NoQtyWorkOrderDisplaySource["lines"]): {
  required: number;
  produced: number;
  balance: number;
} {
  let required = 0;
  let produced = 0;
  let balance = 0;
  for (const l of lines ?? []) {
    const q = Number(l.qty);
    if (Number.isFinite(q)) required += q;
    const p = Number(l.approvedProducedQty ?? 0);
    if (Number.isFinite(p)) produced += p;
    const rem = Number(l.remainingQty ?? NaN);
    if (Number.isFinite(rem)) balance += Math.max(0, rem);
    else balance += Math.max(0, q - p);
  }
  return { required, produced, balance };
}

/** Resolve display status for a WO using production-queue rows when available. */
export function resolveNoQtyCycleDisplayStatusForWorkOrder(
  wo: NoQtyWorkOrderDisplaySource,
  allQueueRows: DashboardProductionStatusSource[],
  opts?: { isPriorCycle?: boolean; scope?: NoQtyCycleDisplayScope },
): NoQtyCycleDisplayStatus {
  const queueLines = allQueueRows.filter((r) => r.workOrderId === wo.id && isNoQty(r.orderType));
  if (queueLines.length) {
    const primary = [...queueLines].sort((a, b) => {
      const remA = Number(a.balanceQty ?? 0);
      const remB = Number(b.balanceQty ?? 0);
      if (remB !== remA) return remB - remA;
      return b.workOrderId - a.workOrderId;
    })[0]!;
    return resolveNoQtyCycleDisplayStatus({
      ...primary,
      allQueueRows,
      woLifecycleStatus: wo.status,
      isPriorCycle: opts?.isPriorCycle,
      scope: opts?.scope,
    });
  }

  const { required, produced, balance } = sumWoLineQty(wo.lines);
  const cycleNo = wo.cycle?.cycleNo != null ? Number(wo.cycle.cycleNo) : null;
  const cycleId = wo.cycleId ?? wo.cycle?.id ?? null;

  return resolveNoQtyCycleDisplayStatus({
    workOrderId: wo.id,
    workOrderNo: `WO-${wo.id}`,
    itemName: "—",
    requiredQty: required,
    producedQty: produced,
    balanceQty: balance,
    orderType: "NO_QTY",
    salesOrderId: wo.salesOrderId,
    cycleId: cycleId != null ? Number(cycleId) : null,
    cycleNo,
    status: wo.status,
    woLifecycleStatus: wo.status,
    allQueueRows,
    isPriorCycle: opts?.isPriorCycle,
    scope: opts?.scope,
  });
}

/** @deprecated Use mapOperationalLabelToNoQtyDisplayLabel */
export function noQtyWorkspaceStatusLabel(operationalLabel: string): string {
  return mapOperationalLabelToNoQtyDisplayLabel(operationalLabel);
}
