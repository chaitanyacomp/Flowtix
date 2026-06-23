import type { ResolvedNoQtyContinuation } from "./noQtyDashboardContinuation";
import { resolveNoQtyDashboardContinuation } from "./noQtyDashboardContinuation";
import type { NoQtyFlowState } from "./noQtyFlowState";
import {
  createCycleRequirementSheetButtonLabel,
  openDraftRsButtonLabel,
} from "./noQtyRsActionLabels";

export type NoQtyDashboardRowSignals = {
  lastRsStatus?: string | null;
  latestRequirementSheetId?: number | null;
  flow?: NoQtyFlowState | null;
};

export type NoQtyDashboardCompactRow = {
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  cycleNo?: number | null;
  cycleId?: number | null;
  planningPointerCycleNo?: number | null;
  planningPointerCycleId?: number | null;
  noQtyPlanningPointerAhead?: boolean;
  latestRequirementSheetId?: number | null;
  lastRsStatus?: string | null;
};

export type NoQtyDashboardSummaryBucket = "create_rs" | "draft_rs" | "ready_place_wo" | "in_progress";

/** True when the SO has any requirement sheet row (draft, locked, or cancelled). */
export function noQtyDashboardRowHasRs(input: NoQtyDashboardRowSignals): boolean {
  if (input.latestRequirementSheetId != null && Number(input.latestRequirementSheetId) > 0) {
    return true;
  }
  const s = String(input.lastRsStatus ?? "").trim().toUpperCase();
  if (s === "DRAFT" || s === "LOCKED" || s === "CANCELLED") return true;
  if (input.flow?.requirementExists) return true;
  return false;
}

export function noQtyDashboardStageLabel(input: {
  lastRsStatus?: string | null;
  noQtyPlanningPointerAhead?: boolean;
  hasRs: boolean;
  readyToPlaceWo?: boolean;
}): string {
  const rs = String(input.lastRsStatus ?? "").trim().toUpperCase();
  if (!input.hasRs) return "RS Pending";
  if (rs === "DRAFT") return "Draft RS";
  if (input.readyToPlaceWo) return "Ready to Place WO";
  if (input.noQtyPlanningPointerAhead) return "Between cycles";
  return "In progress";
}

function targetCycleNoForCreate(input: {
  currentCycleNo?: number | null;
  planningPointerCycleNo?: number | null;
  noQtyPlanningPointerAhead?: boolean;
}): number {
  if (
    input.noQtyPlanningPointerAhead &&
    input.planningPointerCycleNo != null &&
    Number(input.planningPointerCycleNo) > 0
  ) {
    return Number(input.planningPointerCycleNo);
  }
  if (input.currentCycleNo != null && Number(input.currentCycleNo) > 0) {
    return Number(input.currentCycleNo);
  }
  return 1;
}

function nextCycleNoForPrepare(input: {
  currentCycleNo?: number | null;
  planningPointerCycleNo?: number | null;
  noQtyPlanningPointerAhead?: boolean;
}): number {
  const doc = input.currentCycleNo != null && Number(input.currentCycleNo) > 0 ? Number(input.currentCycleNo) : null;
  const ptr =
    input.planningPointerCycleNo != null && Number(input.planningPointerCycleNo) > 0
      ? Number(input.planningPointerCycleNo)
      : null;
  if (input.noQtyPlanningPointerAhead && ptr != null && doc != null && ptr > doc) {
    return ptr;
  }
  if (doc != null) return doc + 1;
  if (ptr != null) return ptr;
  return 2;
}

/** Primary CTA label for dashboard compact rows — never uses next cycle when current cycle has no RS. */
export function resolveNoQtyDashboardActionLabel(input: {
  resolved: ResolvedNoQtyContinuation;
  currentCycleNo?: number | null;
  planningPointerCycleNo?: number | null;
  noQtyPlanningPointerAhead?: boolean;
  lastRsStatus?: string | null;
  hasRs: boolean;
}): string {
  const rs = String(input.lastRsStatus ?? "").trim().toUpperCase();
  if (input.resolved.kind === "prepare_next_rs") {
    return createCycleRequirementSheetButtonLabel(
      nextCycleNoForPrepare({
        currentCycleNo: input.currentCycleNo,
        planningPointerCycleNo: input.planningPointerCycleNo,
        noQtyPlanningPointerAhead: input.noQtyPlanningPointerAhead,
      }),
    );
  }
  if (input.resolved.kind === "navigate") {
    if (rs === "DRAFT") {
      return openDraftRsButtonLabel(
        targetCycleNoForCreate({
          currentCycleNo: input.currentCycleNo,
          planningPointerCycleNo: input.planningPointerCycleNo,
          noQtyPlanningPointerAhead: input.noQtyPlanningPointerAhead,
        }),
      );
    }
    if (!input.hasRs || String(input.resolved.to ?? "").includes("intent=add")) {
      return createCycleRequirementSheetButtonLabel(
        targetCycleNoForCreate({
          currentCycleNo: input.currentCycleNo,
          planningPointerCycleNo: input.planningPointerCycleNo,
          noQtyPlanningPointerAhead: input.noQtyPlanningPointerAhead,
        }),
      );
    }
  }
  return input.resolved.label;
}

export function noQtyDashboardRowToPresentation(args: {
  row: NoQtyDashboardCompactRow;
  flow: NoQtyFlowState | null;
  viewerRole: string;
  commercialContinuation?: boolean;
}): {
  resolved: ResolvedNoQtyContinuation;
  stageLabel: string;
  actionLabel: string;
  summaryBucket: NoQtyDashboardSummaryBucket;
  hasRs: boolean;
} {
  const { row, flow, viewerRole, commercialContinuation = true } = args;
  const planCycleId =
    row.noQtyPlanningPointerAhead &&
    row.planningPointerCycleId != null &&
    Number(row.planningPointerCycleId) > 0
      ? Number(row.planningPointerCycleId)
      : row.cycleId;
  const currentCycleNo =
    row.noQtyPlanningPointerAhead && row.planningPointerCycleNo != null
      ? Number(row.planningPointerCycleNo)
      : row.cycleNo;
  const hasRs = noQtyDashboardRowHasRs({
    lastRsStatus: row.lastRsStatus,
    latestRequirementSheetId: row.latestRequirementSheetId,
    flow,
  });
  const resolved = resolveNoQtyDashboardContinuation({
    salesOrderId: row.salesOrderId,
    cycleId: planCycleId,
    latestRequirementSheetId: row.latestRequirementSheetId,
    lastRsStatus: row.lastRsStatus,
    flow,
    viewerRole,
    commercialContinuation,
  });
  const stageLabel = noQtyDashboardStageLabel({
    lastRsStatus: row.lastRsStatus,
    noQtyPlanningPointerAhead: row.noQtyPlanningPointerAhead,
    hasRs,
    readyToPlaceWo: flow?.readyToPlaceWo,
  });
  const actionLabel = resolveNoQtyDashboardActionLabel({
    resolved,
    currentCycleNo,
    planningPointerCycleNo: row.planningPointerCycleNo,
    noQtyPlanningPointerAhead: row.noQtyPlanningPointerAhead,
    lastRsStatus: row.lastRsStatus,
    hasRs,
  });
  const rs = String(row.lastRsStatus ?? "").trim().toUpperCase();
  let summaryBucket: NoQtyDashboardSummaryBucket = "in_progress";
  if (!hasRs) summaryBucket = "create_rs";
  else if (rs === "DRAFT") summaryBucket = "draft_rs";
  else if (flow?.readyToPlaceWo) summaryBucket = "ready_place_wo";

  return { resolved, stageLabel, actionLabel, summaryBucket, hasRs };
}

export type NoQtyDashboardSummaryCounts = {
  total: number;
  createRsPending: number;
  draftRs: number;
  readyToPlaceWo: number;
};

export function summarizeNoQtyDashboardRows(
  rows: Array<
    NoQtyDashboardRowSignals & {
      salesOrderId: number;
      noQtyPlanningPointerAhead?: boolean;
    }
  >,
  flowBySo: Record<number, NoQtyFlowState | null | undefined>,
): NoQtyDashboardSummaryCounts {
  let createRsPending = 0;
  let draftRs = 0;
  let readyToPlaceWo = 0;
  for (const row of rows) {
    const flow = flowBySo[row.salesOrderId] ?? null;
    const hasRs = noQtyDashboardRowHasRs({ ...row, flow });
    const rs = String(row.lastRsStatus ?? "").trim().toUpperCase();
    if (!hasRs) createRsPending += 1;
    else if (rs === "DRAFT") draftRs += 1;
    else if (flow?.readyToPlaceWo) readyToPlaceWo += 1;
  }
  return { total: rows.length, createRsPending, draftRs, readyToPlaceWo };
}
