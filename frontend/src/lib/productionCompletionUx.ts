/** Production Completion workflow — three operator-facing scenarios (P16-C). */

import type { ProductionExecutionSummary } from "./productionExecutionApi";

const EPS = 1e-6;

export type ProductionCompletionScenario =
  | "OPEN"
  | "PAUSED"
  | "DONE"
  | "SHORTFALL"
  | "COMPLETE"
  | "SURPLUS";

export function resolveProductionCompletionScenario(
  summary: ProductionExecutionSummary | null | undefined,
): ProductionCompletionScenario {
  if (!summary) return "OPEN";
  if (summary.executionStatus === "COMPLETED") return "DONE";
  if (summary.executionStatus === "BLOCKED") return "PAUSED";
  if (summary.executionStatus === "SHORTFALL_PENDING") return "SHORTFALL";
  const produced = Number(summary.producedQty ?? 0);
  const planned = Number(summary.plannedQty ?? 0);
  if (produced <= EPS) return "OPEN";
  const surplus = Number(summary.surplusQty ?? Math.max(0, produced - planned));
  const remainder = Number(summary.remainderQty ?? Math.max(0, planned - produced));
  if (surplus > EPS) return "SURPLUS";
  if (remainder > EPS) return "SHORTFALL";
  return "COMPLETE";
}

export function shouldAutoEvaluateProductionCompletion(
  summary: ProductionExecutionSummary | null | undefined,
): boolean {
  const scenario = resolveProductionCompletionScenario(summary);
  return scenario === "SHORTFALL" || scenario === "COMPLETE" || scenario === "SURPLUS";
}

export function formatProductionCompletionSuccessMessage(
  summary: ProductionExecutionSummary,
  serverMessage?: string | null,
): string {
  if (serverMessage?.trim()) return serverMessage.trim();
  const label = summary.workOrderDocNo?.trim() || `WO-${summary.workOrderId}`;
  const surplus = Number(summary.surplusQty ?? 0);
  if (surplus > EPS) {
    return `Production completed successfully. Extra Production: ${surplus} Qty. Work Order ${label} closed.`;
  }
  return `Production completed successfully. Work Order ${label} closed.`;
}

export const WAIVE_REASON_OPTIONS = [
  "MANAGEMENT_DECISION",
  "CUSTOMER_PRIORITY_CHANGE",
  "QUALITY_CONCERN",
  "OTHER",
] as const;

export const CARRY_FORWARD_REASON_OPTIONS = [
  "MACHINE_BREAKDOWN",
  "CAPACITY_CONSTRAINT",
  "WAITING_FOR_RM",
  "TOOL_MAINTENANCE",
  "OTHER",
] as const;

export const PAUSE_REASON_OPTIONS = [
  "MACHINE_BREAKDOWN",
  "POWER_UTILITY_FAILURE",
  "TOOL_MOULD_MAINTENANCE",
  "WAITING_FOR_RM",
  "QUALITY_CONCERN",
  "MANAGEMENT_HOLD",
  "OTHER",
] as const;

export function completionEvaluationSignature(summary: ProductionExecutionSummary): string {
  return `${summary.workOrderId}:${summary.executionStatus}:${summary.producedQty}:${summary.plannedQty}:${summary.remainderQty}:${summary.surplusQty ?? 0}`;
}

export function formatExecutionStatusSummary(summary: ProductionExecutionSummary): string {
  const parts = [`Produced ${summary.producedQty}`, `Planned ${summary.plannedQty}`];
  if (Number(summary.remainderQty ?? 0) > EPS) {
    parts.push(`Remaining ${summary.remainderQty}`);
  }
  if (Number(summary.surplusQty ?? 0) > EPS) {
    parts.push(`Extra ${summary.surplusQty}`);
  }
  return parts.join(" / ");
}

/** @deprecated use resolveProductionCompletionScenario */
export function shouldOpenShortfallResolutionOnFinish(
  summary: ProductionExecutionSummary | null | undefined,
): boolean {
  return resolveProductionCompletionScenario(summary) === "SHORTFALL";
}

export function shouldShowProductionExecutionPanel(
  summary: ProductionExecutionSummary | null | undefined,
): boolean {
  if (!summary) return false;
  const scenario = resolveProductionCompletionScenario(summary);
  if (scenario === "DONE") return false;
  if (scenario === "PAUSED") return true;
  if (scenario === "SHORTFALL") return true;
  if (Number(summary.producedQty ?? 0) > EPS) return true;
  if (Number(summary.productionPendingQty ?? summary.remainderQty ?? 0) > EPS) return true;
  return summary.executionStatus === "RUNNING";
}

/** Unresolved less-than-WO shortfall — operator must Waive, Carry Forward, or Pause. */
export function hasPendingShortfallDecision(
  summary: ProductionExecutionSummary | null | undefined,
): boolean {
  if (!summary) return false;
  if (summary.pendingShortfallResolution === true) return true;
  return summary.executionStatus === "SHORTFALL_PENDING";
}

/** Hide NO_QTY production qty entry while shortfall decision is unresolved or paused after shortfall. */
export function hasPausedShortfallDecision(
  summary: ProductionExecutionSummary | null | undefined,
): boolean {
  if (!summary) return false;
  if (summary.executionStatus !== "BLOCKED") return false;
  if (Number(summary.producedQty ?? 0) <= EPS) return false;
  return Number(summary.remainderQty ?? 0) > EPS;
}

export function shouldShowShortfallResolutionPanel(
  summary: ProductionExecutionSummary | null | undefined,
): boolean {
  return hasPendingShortfallDecision(summary) || hasPausedShortfallDecision(summary);
}

/** Hide NO_QTY production qty entry while shortfall decision is unresolved. */
export function shouldBlockNoQtyProductionEntry(
  summary: ProductionExecutionSummary | null | undefined,
): boolean {
  return shouldShowShortfallResolutionPanel(summary);
}

/** NO_QTY production qty entry allowed (not blocked by shortfall decision states). */
export function allowsNoQtyProductionEntry(
  summary: ProductionExecutionSummary | null | undefined,
): boolean {
  return !shouldBlockNoQtyProductionEntry(summary);
}

export function formatWaiveSuccessMessage(
  workOrderDocNo: string | null | undefined,
  workOrderId: number,
  remainderQty: number,
): string {
  const label = (workOrderDocNo && String(workOrderDocNo).trim()) || `WO-${workOrderId}`;
  const rem = Math.round(Number(remainderQty) * 1000) / 1000;
  return `${label} closed. Remaining ${rem} qty waived/cancelled.`;
}

export function formatCarryForwardSuccessMessage(
  workOrderDocNo: string | null | undefined,
  workOrderId: number,
  remainderQty: number,
): string {
  const label = (workOrderDocNo && String(workOrderDocNo).trim()) || `WO-${workOrderId}`;
  const rem = Math.round(Number(remainderQty) * 1000) / 1000;
  return `${label} closed. Remaining ${rem} qty carried forward.`;
}

export function formatProductionExecutionFinishSuccessMessage(
  workOrderDocNo: string | null | undefined,
  workOrderId: number,
  outcome: "CARRY_FORWARD" | "WAIVE_BALANCE" | "FULL_COMPLETE" | string,
  remainderQty: number,
): string | null {
  if (outcome === "WAIVE_BALANCE") {
    return formatWaiveSuccessMessage(workOrderDocNo, workOrderId, remainderQty);
  }
  if (outcome === "CARRY_FORWARD") {
    return formatCarryForwardSuccessMessage(workOrderDocNo, workOrderId, remainderQty);
  }
  return null;
}

export function workOrderLinesMetricsSignature(
  rows: Array<{ id: number; lines?: Array<{ id: number; approvedProducedQty?: number; remainingQty?: number }> }>,
): string {
  return rows
    .flatMap((wo) =>
      (wo.lines ?? []).map(
        (l) => `${wo.id}:${l.id}:${Number(l.approvedProducedQty ?? 0)}:${Number(l.remainingQty ?? 0)}`,
      ),
    )
    .join("|");
}

export function productionEntriesRefreshSignature(
  rows: Array<{ id: number; producedQty?: number | string; workflowStatus?: string }>,
): string {
  return rows.map((r) => `${r.id}:${r.producedQty ?? 0}:${r.workflowStatus ?? ""}`).join("|");
}

export type ProductionExecutionClosedOutcome = "COMPLETE" | "SURPLUS" | "WAIVE_BALANCE" | "CARRY_FORWARD";

export type ShortfallDecisionChoice = "waive" | "carry" | "pause";

export type PausedShortfallDecisionChoice = "resume" | "waive" | "carry";

export const SHORTFALL_DECISION_CHOICES: Array<{
  id: ShortfallDecisionChoice;
  label: string;
  description: string;
  confirmLabel: string;
}> = [
  {
    id: "waive",
    label: "Waive",
    description: "Close this WO and cancel the remaining qty — it will not carry to the next RS.",
    confirmLabel: "Waive remaining qty",
  },
  {
    id: "carry",
    label: "Carry forward",
    description: "Close this WO and add the remaining qty to the next Requirement Sheet.",
    confirmLabel: "Carry forward remaining qty",
  },
  {
    id: "pause",
    label: "Pause",
    description: "Keep the WO open — resume production later or choose waive / carry forward when ready.",
    confirmLabel: "Pause production",
  },
];

export const PAUSED_SHORTFALL_DECISION_CHOICES: Array<{
  id: PausedShortfallDecisionChoice;
  label: string;
  description: string;
  confirmLabel: string;
}> = [
  {
    id: "resume",
    label: "Resume",
    description: "Return to RUNNING and allow producing the remaining qty on the shop floor.",
    confirmLabel: "Resume production",
  },
  {
    id: "waive",
    label: "Waive",
    description: "Close this WO and cancel the remaining qty — it will not carry to the next RS.",
    confirmLabel: "Waive remaining qty",
  },
  {
    id: "carry",
    label: "Carry forward",
    description: "Close this WO and add the remaining qty to the next Requirement Sheet.",
    confirmLabel: "Carry forward remaining qty",
  },
];

export type NoQtyProductionLineCandidate = {
  id: number;
  workOrderId: number;
  salesOrderId: number;
  approvedProducedQty?: number;
  remainingQty?: number;
  qty: string;
};

export function remainingQtyForProductionLine(l: NoQtyProductionLineCandidate): number {
  if (l.remainingQty != null && Number.isFinite(Number(l.remainingQty))) {
    return Math.max(0, Number(l.remainingQty));
  }
  const approved = Number(l.approvedProducedQty ?? 0);
  const planned = Number(l.qty);
  return Number.isFinite(planned) ? Math.max(0, planned - approved) : 0;
}

function sortProductionLinesByPriority(lines: NoQtyProductionLineCandidate[]): NoQtyProductionLineCandidate[] {
  return [...lines].sort((a, b) => {
    const d = remainingQtyForProductionLine(b) - remainingQtyForProductionLine(a);
    if (Math.abs(d) > EPS) return d;
    if (b.workOrderId !== a.workOrderId) return b.workOrderId - a.workOrderId;
    return b.id - a.id;
  });
}

/** Next production-ready WO line in the same SO after the current WO execution closes. */
export function selectNextNoQtyProductionReadyLine(args: {
  lines: NoQtyProductionLineCandidate[];
  salesOrderId: number;
  excludeWorkOrderId: number;
  qcPendingByWolId?: Map<number, number> | Record<number, number>;
  approvedWolIds?: Set<number> | number[];
}): NoQtyProductionLineCandidate | null {
  const soId = Number(args.salesOrderId);
  const closedWoId = Number(args.excludeWorkOrderId);
  if (!(soId > 0)) return null;

  const qcMap = args.qcPendingByWolId ?? {};
  const qcPending = (wolId: number): number => {
    if (qcMap instanceof Map) return qcMap.get(wolId) ?? 0;
    return Number((qcMap as Record<number, number>)[wolId] ?? 0);
  };
  const approvedSet =
    args.approvedWolIds instanceof Set
      ? args.approvedWolIds
      : new Set((args.approvedWolIds ?? []).filter((id) => id > 0));

  const ready = args.lines.filter((l) => {
    if (l.salesOrderId !== soId) return false;
    if (l.workOrderId === closedWoId) return false;
    const rem = remainingQtyForProductionLine(l);
    if (!(rem > EPS)) return false;
    const produced = Number(l.approvedProducedQty ?? 0);
    const pending = qcPending(l.id);
    const carryForward = produced > EPS && pending <= EPS && approvedSet.has(l.id);
    return !carryForward && pending <= EPS;
  });

  const sorted = sortProductionLinesByPriority(ready);
  return sorted[0] ?? null;
}

export function formatNoQtyProductionQueueCompleteMessage(workOrderLabel: string): string {
  const label = workOrderLabel.trim() || "Work order";
  return `${label} completed. No other production-ready work orders in this cycle — pick another line from the queue or continue to QC.`;
}

export function formatNoQtyProductionAdvanceMessage(workOrderLabel: string, itemName?: string | null): string {
  const wo = workOrderLabel.trim() || "Next work order";
  const item = (itemName ?? "").trim();
  return item ? `Continuing on ${wo} · ${item}` : `Continuing on ${wo}`;
}
