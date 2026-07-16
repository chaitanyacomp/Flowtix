import * as React from "react";
import {
  UNSAVED_CHANGES_BEFOREUNLOAD_MESSAGE,
  UNSAVED_CHANGES_LEAVE_MESSAGE,
  confirmLeaveIfDirty,
} from "../lib/unsavedChangesPolicy";
import { useDirtyFormRegistry } from "../contexts/DirtyFormContext";

export type UseUnsavedChangesGuardOptions = {
  /** When true, block tab close / refresh and register for in-app leave confirm. */
  isDirty: boolean;
  /** Optional operator-facing leave message (in-app confirm). */
  message?: string;
  /** Disable registration (e.g. after successful finalize while remounting). */
  enabled?: boolean;
};

/**
 * Standard ERP dirty-form policy:
 * - `beforeunload` only while dirty (refresh / tab close).
 * - Registers with DirtyFormContext so sidebar / back / Link navigation can confirm.
 * Does not use React Router useBlocker (requires data router); BrowserRouter + registry is intentional.
 */
export function useUnsavedChangesGuard({
  isDirty,
  message = UNSAVED_CHANGES_LEAVE_MESSAGE,
  enabled = true,
}: UseUnsavedChangesGuardOptions): {
  isDirty: boolean;
  confirmLeave: () => boolean;
} {
  const registry = useDirtyFormRegistry();
  const id = React.useId();
  const active = Boolean(enabled && isDirty);

  React.useEffect(() => {
    if (!enabled) {
      registry?.unregister(id);
      return;
    }
    registry?.register(id, active, message);
    return () => registry?.unregister(id);
  }, [registry, id, active, message, enabled]);

  React.useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = UNSAVED_CHANGES_BEFOREUNLOAD_MESSAGE;
      return UNSAVED_CHANGES_BEFOREUNLOAD_MESSAGE;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  const confirmLeave = React.useCallback(
    () => confirmLeaveIfDirty(active, message),
    [active, message],
  );

  return { isDirty: active, confirmLeave };
}
