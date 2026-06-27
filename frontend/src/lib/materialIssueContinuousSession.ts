/**
 * Material Issue continuous processing — session scope and post-issue UX (read-model only).
 */

import type { PendingPmrSummary } from "./materialIssueWorkspace";
import { pickActionablePmrForWorkOrder } from "./materialIssueWorkspace";

export type MaterialIssueSessionScope = {
  requirementSheetId?: number | null;
  salesOrderId?: number | null;
};

export type MaterialIssueSessionComplete = {
  requirementSheetId?: number | null;
  salesOrderId?: number | null;
  lastWorkOrderId: number;
  lastWorkOrderNo: string | null;
};

const EPS = 1e-6;

export function placementQuantitiesMatchSuggested(
  lines: Array<{ itemId: number; suggestedExecutableQty: number }>,
  draftQtyByItem: Record<number, string>,
): boolean {
  for (const line of lines) {
    const draft = Number(draftQtyByItem[line.itemId] ?? 0);
    if (!Number.isFinite(draft)) return false;
    if (Math.abs(draft - line.suggestedExecutableQty) > EPS) return false;
  }
  return true;
}

export function parseMaterialIssueSessionScope(params: {
  requirementSheetId?: string | null;
  salesOrderId?: string | null;
}): MaterialIssueSessionScope {
  const requirementSheetId = Number(params.requirementSheetId ?? 0);
  const salesOrderId = Number(params.salesOrderId ?? 0);
  return {
    requirementSheetId: requirementSheetId > 0 ? requirementSheetId : null,
    salesOrderId: salesOrderId > 0 ? salesOrderId : null,
  };
}

export function filterPendingPmrsForSessionScope(
  pmrs: PendingPmrSummary[],
  scope: MaterialIssueSessionScope,
): PendingPmrSummary[] {
  if (scope.requirementSheetId && scope.requirementSheetId > 0) {
    return pmrs.filter((p) => Number(p.requirementSheetId ?? 0) === scope.requirementSheetId);
  }
  if (scope.salesOrderId && scope.salesOrderId > 0) {
    return pmrs.filter((p) => Number(p.salesOrderId ?? 0) === scope.salesOrderId);
  }
  return pmrs;
}

export function formatMaterialIssueSuccessMessage(workOrderLabel: string): string {
  const label = workOrderLabel.trim() || "work order";
  return `Material issued successfully for ${label}.`;
}

export function materialIssueSessionCompleteHeadline(scope: MaterialIssueSessionScope): string {
  if (scope.requirementSheetId && scope.requirementSheetId > 0) {
    return "All material has been issued for this Requirement Sheet.";
  }
  if (scope.salesOrderId && scope.salesOrderId > 0) {
    return "All pending material has been issued for this sales order.";
  }
  return "All pending material requests have been issued.";
}

/** Store handoff completion title (P15-C4). */
export function materialIssueSessionCompleteTitle(): string {
  return "All material issued successfully.";
}

/** Store handoff completion message — no Production navigation for Store role. */
export function materialIssueSessionCompleteMessage(): string {
  return "Store handoff complete. RM has been issued to Production/WIP. Production team can now start production execution.";
}

export function formatMaterialIssueInlineStatus(input: {
  pmrDocNo?: string | null;
  pmrId?: number | null;
  pendingLineCount: number;
}): string {
  const doc = input.pmrDocNo?.trim() || (input.pmrId ? `PMR-${input.pmrId}` : "PMR");
  const count = Math.max(0, Number(input.pendingLineCount ?? 0));
  const lineLabel = count === 1 ? "1 line pending" : `${count} lines pending`;
  return `${doc} · Waiting for RM Issue · ${lineLabel}`;
}

export function pickNextPendingPmrInScope(
  pmrs: PendingPmrSummary[],
  scope: MaterialIssueSessionScope,
  excludeWorkOrderId?: number,
): PendingPmrSummary | null {
  const scoped = filterPendingPmrsForSessionScope(pmrs, scope);
  const excludeWo = Number(excludeWorkOrderId ?? 0);
  for (const p of scoped) {
    const woId = Number(p.workOrderId ?? 0);
    if (excludeWo > 0 && woId === excludeWo) continue;
    if (woId > 0) {
      const picked = pickActionablePmrForWorkOrder(woId, scoped);
      if (picked) return picked;
    }
  }
  return scoped[0] ?? null;
}
