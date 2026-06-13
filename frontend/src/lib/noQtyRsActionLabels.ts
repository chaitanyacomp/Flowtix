/**
 * P6B-4A — Cycle-oriented NO_QTY labels (business language, not PMR/WO doc numbers).
 */

export type NoQtyCycleRsContext = {
  currentCycleNo?: number | null;
  nextCycleNo?: number | null;
  rsStatus?: string | null;
  hasRs?: boolean | null;
  isDraft?: boolean | null;
};

/** Human workflow stage from backend processStage.key / label. */
export function noQtyBusinessWorkflowStage(input: {
  processStageKey?: string | null;
  processStageLabel?: string | null;
  rsStatus?: string | null;
  hasRs?: boolean | null;
}): string {
  const key = String(input.processStageKey ?? "").toUpperCase();
  const label = String(input.processStageLabel ?? "").trim();

  if (key === "NO_QTY_PREPARE_NEXT_RS") return "Cycle review · Next RS";
  if (key === "NO_QTY_DRAFT" || (!input.hasRs && key !== "COMPLETED")) return "Requirement Sheet pending";
  if (key === "NO_QTY_REQUIREMENT_READY") return "RS locked · Monthly Planning pending";
  if (key === "NO_QTY_WORK_ORDER") return "Work Order pending";
  if (key === "NO_QTY_IN_PRODUCTION") return "Production / QA in progress";
  if (key === "NO_QTY_DISPATCH_BILLING") return "Dispatch / Billing";
  if (key === "NO_QTY_BILLING_COMPLETE") return "Billing complete";
  if (key === "COMPLETED") return "Agreement closed";

  if (label) return label;
  const rs = String(input.rsStatus ?? "").trim();
  if (rs === "Draft") return "Requirement Sheet draft";
  if (rs === "Locked") return "RS locked";
  if (rs === "No RS") return "Requirement Sheet pending";
  return "In progress";
}

/** Business-friendly Next RS block reason — never lead with PMR/WO doc numbers. */
export function noQtyBusinessNextRsBlockReason(reason?: string | null): string {
  const r = String(reason ?? "").trim();
  if (!r || r === "OK") return "";

  if (r === "NO_LOCKED_RS" || r === "DRAFT_RS_ON_CYCLE") {
    return "Current cycle Requirement Sheet is not locked yet.";
  }
  if (r === "DRAFT_RS_EXISTS") return "A draft Requirement Sheet already exists on the next cycle.";
  if (r === "NEXT_RS_EXISTS") return "A Requirement Sheet already exists on the next cycle.";
  if (r === "NOT_NO_QTY") return "This action applies only to NO_QTY agreements.";
  if (r === "SO_CLOSED") return "This NO_QTY agreement is closed.";
  if (r === "NO_CYCLE" || r === "INVALID_CYCLE" || r === "CYCLE_NOT_FOUND") {
    return "No active cycle is available for the next Requirement Sheet.";
  }
  if (r === "INVALID_SO") return "Invalid sales order.";

  return r.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) + ".";
}

export function noQtyCurrentCycleLabel(cycleNo?: number | null): string {
  if (cycleNo != null && Number.isFinite(Number(cycleNo)) && Number(cycleNo) > 0) {
    return `Cycle ${Number(cycleNo)}`;
  }
  return "—";
}

export function noQtyNextCycleLabel(nextCycleNo?: number | null): string {
  if (nextCycleNo != null && Number.isFinite(Number(nextCycleNo)) && Number(nextCycleNo) > 0) {
    return `Cycle ${Number(nextCycleNo)}`;
  }
  return "—";
}

export function openCurrentRsButtonLabel(): string {
  return "Open Current RS";
}

export function openDraftRsButtonLabel(cycleNo?: number | null): string {
  const c = noQtyCurrentCycleLabel(cycleNo);
  return c !== "—" ? `Open Draft RS (${c})` : "Open Draft RS";
}

/** Create RS for a specific cycle number. */
export function createCycleRsButtonLabel(cycleNo: number): string {
  return `Create Cycle ${cycleNo} RS`;
}

/** When next cycle number unknown, use generic label. */
export function createNextRsButtonLabel(nextCycleNo?: number | null): string {
  if (nextCycleNo != null && Number(nextCycleNo) > 0) {
    return createCycleRsButtonLabel(Number(nextCycleNo));
  }
  return "Create Next RS";
}

export function resolveCreateRsButtonLabel(ctx: {
  hasRs?: boolean | null;
  rsStatus?: string | null;
  currentCycleNo?: number | null;
  nextCycleNo?: number | null;
  createNextRsEligible?: boolean;
}): string {
  const hasRs = ctx.hasRs === true || (ctx.rsStatus && ctx.rsStatus !== "No RS");
  if (!hasRs) {
    const n = ctx.currentCycleNo ?? ctx.nextCycleNo ?? 1;
    return createCycleRsButtonLabel(Math.max(1, Number(n) || 1));
  }
  if (ctx.createNextRsEligible && ctx.nextCycleNo != null && ctx.nextCycleNo > 0) {
    return createCycleRsButtonLabel(ctx.nextCycleNo);
  }
  return createNextRsButtonLabel(ctx.nextCycleNo);
}

export function noQtyNextRsStatusHeadline(eligible: boolean, nextRsAlreadyExists?: boolean): string {
  if (nextRsAlreadyExists) return "Next RS: Already on next cycle";
  if (eligible) return "Next RS Ready";
  return "Next RS Blocked";
}

export function noQtySoListHref(salesOrderId?: number): string {
  const base = "/sales-orders?soType=NO_QTY";
  if (salesOrderId != null && salesOrderId > 0) {
    return `${base}&salesOrderId=${encodeURIComponent(String(salesOrderId))}`;
  }
  return base;
}
