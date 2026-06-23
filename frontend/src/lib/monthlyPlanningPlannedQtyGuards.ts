/**
 * Planned qty vs suggested production — submit/approve confirmation (Green Shortage).
 */

export const GREEN_SHORTAGE_PLANNING_MESSAGE =
  "Green Shortage is part of suggested production to maintain FG Green Level.";

export const PLANNED_BELOW_SUGGESTED_CONFIRM_CODE = "PLANNED_BELOW_SUGGESTED_CONFIRM_REQUIRED";

export function formatPlannedBelowSuggestedSubmitMessage(): string {
  return (
    "One or more FG lines have planned quantity below suggested production while Green Shortage applies.\n\n" +
    "Suggested production includes RS demand, carry forward, and Green Shortage.\n\n" +
    "Submit anyway with the lower planned quantities?"
  );
}

export function formatPlannedBelowSuggestedApproveMessage(): string {
  return (
    "Planned FG quantity is below suggested production for items with Green Shortage.\n\n" +
    "RM procurement still follows Green Shortage (BOM). FG planned qty will remain below the green buffer target.\n\n" +
    "Approve anyway?"
  );
}

export function isPlannedBelowSuggestedConfirmError(code: string | undefined): boolean {
  return code === PLANNED_BELOW_SUGGESTED_CONFIRM_CODE;
}

export function rowHasGreenShortagePlannedGap(args: {
  greenShortage: number;
  plannedQty: number;
  suggestedQty: number;
}): boolean {
  return args.greenShortage > 0 && args.plannedQty + 1e-9 < args.suggestedQty;
}
