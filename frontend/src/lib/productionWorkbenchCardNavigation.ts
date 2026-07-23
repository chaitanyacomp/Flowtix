/**
 * Whole-card navigation helpers for Production Workbench cards.
 * Card click and primary button must resolve to the same destination/action.
 */

import {
  classifyProductionWorkbenchState,
  workbenchStatePrimaryActionLabel,
  type ProductionWorkbenchState,
  type ProductionWorkbenchStateSource,
} from "./productionWorkbenchState";
import { canAcceptNewProductionEntry } from "./productionActiveEligibility";

export type ProductionWorkbenchCardAction =
  | { kind: "resume" }
  | { kind: "navigate"; href: string }
  | { kind: "openRow" };

export function resolveProductionWorkbenchCardAction(opts: {
  state: ProductionWorkbenchState;
  href: string;
  hasOpenRowHandler: boolean;
}): ProductionWorkbenchCardAction {
  if (opts.state === "PAUSED_PRODUCTION") return { kind: "resume" };
  if (
    opts.hasOpenRowHandler &&
    (opts.state === "READY_TO_START" ||
      opts.state === "CONTINUE_PRODUCTION" ||
      opts.state === "DRAFT_PENDING" ||
      opts.state === "PRODUCTION_REPORT_PENDING")
  ) {
    return { kind: "openRow" };
  }
  return { kind: "navigate", href: opts.href };
}

export function productionWorkbenchCardAriaLabel(opts: {
  state: ProductionWorkbenchState;
  workOrderNo: string;
  itemName: string;
}): string {
  return `${workbenchStatePrimaryActionLabel(opts.state)}: ${opts.workOrderNo} · ${opts.itemName}`;
}

export function cardStateFromRow(row: ProductionWorkbenchStateSource): ProductionWorkbenchState {
  return classifyProductionWorkbenchState(row);
}

/** Keyboard activation for focusable cards (Enter / Space). */
export function isCardActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function resolveProductionWorkspaceRowAccess(row: ProductionWorkbenchStateSource & {
  workOrderId?: number | null;
  workOrderLineId?: number | null;
  productionReportConfirmed?: boolean;
}): { allowed: boolean; reason: string | null } {
  if (!(Number(row.workOrderId) > 0)) {
    return { allowed: false, reason: "Cannot open this item because its Work Order identity is missing." };
  }
  if (canAcceptNewProductionEntry(row)) return { allowed: true, reason: null };
  if (
    row.productionReportConfirmed ||
    upperForAccess(row.productionExecutionStatus) === "SHORTFALL_PENDING"
  ) {
    return { allowed: true, reason: null };
  }
  return {
    allowed: false,
    reason: "This production item has no editable production or report action.",
  };
}

function upperForAccess(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}
