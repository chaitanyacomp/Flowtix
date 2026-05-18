import { ROW_NUM_EPS } from "./dispatchBacklog";

export type NoQtyQueueRow = {
  workOrderId: number;
  orderType?: string | null;
  balanceQty?: number | null;
  requiredQty?: number | null;
  producedQty?: number | null;
  lastShortageQty?: number | null;
};

type NoQtyOperationalStatus = {
  tone?: "carryForward" | "carriedForward" | string;
};

/** Operator-facing: pending / remaining on the WO line (planned − approved produced). */
export const NO_QTY_OPERATOR_PENDING_LABEL = "Pending qty";
export const NO_QTY_OPERATOR_REMAINING_LABEL = "Remaining qty";
export const NO_QTY_NEXT_CYCLE_PENDING_LABEL = "Next cycle pending";

/** RS planning carry-forward (`lastShortageQty` / shortfallQty): prior planned qty minus approved produced qty. */
export const NO_QTY_ERP_ADJUSTED_PLANNING_LABEL = "Carry-forward planning qty";
export const NO_QTY_ERP_ADJUSTED_PLANNING_TOOLTIP =
  "Prior cycle planned qty minus approved produced qty. QC stock remains dispatchable, but does not reduce this planning carry-forward.";

/**
 * Operator-visible pending qty = planned − approved produced.
 * Prefers WO `balanceQty` when the API provides it.
 */
export function noQtyOperatorPendingQtyFromRow(row: {
  balanceQty?: number | null;
  requiredQty?: number | null;
  producedQty?: number | null;
}): number {
  const balance = Math.max(0, Number(row.balanceQty ?? 0));
  if (balance > ROW_NUM_EPS) return balance;
  const required = Math.max(0, Number(row.requiredQty ?? 0));
  const produced = Math.max(0, Number(row.producedQty ?? 0));
  return Math.max(0, required - produced);
}

/** Carry-forward planning qty from API (`lastShortageQty` on production-queue rows). */
export function noQtyErpAdjustedPlanningQty(row: { lastShortageQty?: number | null }): number {
  const n = Number(row.lastShortageQty ?? 0);
  return Number.isFinite(n) && n > ROW_NUM_EPS ? n : 0;
}

/** @deprecated Use noQtyErpAdjustedPlanningQty */
export const noQtyFinalCarryForwardShortage = noQtyErpAdjustedPlanningQty;

export function sumNoQtyErpAdjustedPlanningQty(
  lines: Array<{ lastShortageQty?: number | null }>,
): number {
  let sum = 0;
  for (const l of lines) sum += noQtyErpAdjustedPlanningQty(l);
  return sum;
}

/** @deprecated Use sumNoQtyErpAdjustedPlanningQty */
export const sumNoQtyFinalCarryForwardShortage = sumNoQtyErpAdjustedPlanningQty;

export function sumNoQtyOperatorPendingQty(
  lines: Array<{
    balanceQty?: number | null;
    requiredQty?: number | null;
    producedQty?: number | null;
  }>,
): number {
  let sum = 0;
  for (const l of lines) sum += noQtyOperatorPendingQtyFromRow(l);
  return sum;
}

/** True when row is in next-cycle / carried-forward workflow (label context only — qty stays operational pending). */
export function noQtyIsNextCyclePendingContext(input: {
  orderType?: string | null;
  lastShortageQty?: number | null;
  nextAction?: string | null;
  operationalStatus?: NoQtyOperationalStatus;
}): boolean {
  if (input.orderType !== "NO_QTY") return false;
  const next = String(input.nextAction ?? "").toUpperCase();
  if (next === "NEXT_RS_REQUIRED") return true;
  const tone = input.operationalStatus?.tone;
  return tone === "carryForward" || tone === "carriedForward";
}

/** @deprecated Use noQtyIsNextCyclePendingContext */
export const noQtyShouldShowCarryForwardShortage = noQtyIsNextCyclePendingContext;

/** Third metric on dashboard / production workspace rows (NO_QTY uses operational pending only). */
export function noQtyOperatorThirdColumn(input: {
  orderType?: string | null;
  lastShortageQty?: number | null;
  nextAction?: string | null;
  operationalStatus?: NoQtyOperationalStatus;
  remainingQty: number;
  requiredQty?: number | null;
  producedQty?: number | null;
}): { qty: number; header: string; label: string } {
  if (input.orderType !== "NO_QTY") {
    return { qty: input.remainingQty, header: "Rem", label: NO_QTY_OPERATOR_REMAINING_LABEL };
  }
  const qty = noQtyOperatorPendingQtyFromRow({
    balanceQty: input.remainingQty,
    requiredQty: input.requiredQty,
    producedQty: input.producedQty,
  });
  const nextCycle = noQtyIsNextCyclePendingContext(input);
  return {
    qty,
    header: nextCycle ? "Pending" : "Rem",
    label: nextCycle ? NO_QTY_OPERATOR_PENDING_LABEL : NO_QTY_OPERATOR_REMAINING_LABEL,
  };
}

export function noQtyOperatorPendingQtyForWorkOrder(
  workOrderId: number,
  queueRows: NoQtyQueueRow[],
): number {
  const lines = queueRows.filter((r) => r.workOrderId === workOrderId && r.orderType === "NO_QTY");
  return sumNoQtyOperatorPendingQty(lines);
}

export function noQtyErpAdjustedPlanningQtyForWorkOrder(
  workOrderId: number,
  queueRows: NoQtyQueueRow[],
): number {
  const lines = queueRows.filter((r) => r.workOrderId === workOrderId && r.orderType === "NO_QTY");
  return sumNoQtyErpAdjustedPlanningQty(lines);
}

/** @deprecated Use noQtyOperatorPendingQtyForWorkOrder */
export const noQtyCarryForwardShortageForWorkOrder = noQtyOperatorPendingQtyForWorkOrder;
