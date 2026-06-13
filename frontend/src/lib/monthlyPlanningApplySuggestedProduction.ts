/**
 * P7F-CA5 — Apply suggested production patch/toast helpers (frontend workflow only).
 */

export const APPLY_SUGGESTED_PLANNED_SUCCESS_TOAST =
  "Suggested production applied to planned quantity. Save changes before locking.";

export const APPLY_SUGGESTED_ADDED_SUCCESS_TOAST =
  "Suggested production added. Save changes before locking.";

export const APPLY_SUGGESTED_CANCEL_INFO_TOAST = "Planned quantity was not changed.";

export type ApplySuggestedRowPatch = {
  suggestedFgQty: number;
  plannedFgQty: string;
  plannedQtyOverridden: false;
  source: "REQUIREMENT_SHEET";
};

export function shouldConfirmOverrideReplace(plannedQtyOverridden: boolean): boolean {
  return plannedQtyOverridden === true;
}

export function buildApplySuggestedExistingRowPatch(suggested: number): ApplySuggestedRowPatch {
  return {
    suggestedFgQty: suggested,
    plannedFgQty: String(suggested),
    plannedQtyOverridden: false,
    source: "REQUIREMENT_SHEET",
  };
}

export function formatApplySuggestedOverrideConfirmMessage(plannedQty: number, suggestedQty: number): string {
  return `Planned quantity is manually set to ${plannedQty.toLocaleString()}.\n\nSuggested production is ${suggestedQty.toLocaleString()}.\n\nReplace planned quantity with suggested production?`;
}
