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
