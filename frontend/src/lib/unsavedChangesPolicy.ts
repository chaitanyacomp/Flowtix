/** Shared copy for dirty-form leave warnings (browser + in-app). */
export const UNSAVED_CHANGES_LEAVE_MESSAGE =
  "You have unsaved changes. Leave this page and discard them?";

export const UNSAVED_CHANGES_BEFOREUNLOAD_MESSAGE =
  "You have unsaved changes that will be lost if you leave this page.";

/**
 * Confirm leave when any registered form is dirty.
 * Returns true when navigation may proceed.
 */
export function confirmLeaveIfDirty(isDirty: boolean, message = UNSAVED_CHANGES_LEAVE_MESSAGE): boolean {
  if (!isDirty) return true;
  if (typeof window === "undefined") return true;
  return window.confirm(message);
}
