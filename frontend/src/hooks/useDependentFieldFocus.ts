import * as React from "react";

type UseDependentFieldFocusOpts = {
  /** Field to receive focus when `enabled` is true (e.g. quantity after prerequisites). */
  targetRef: React.RefObject<HTMLElement | null>;
  /** When false, no auto-focus (user still completing SO / FG, etc.). */
  enabled: boolean;
  /** When any dep changes while enabled, focus runs again (e.g. FG changed → refocus qty). */
  deps: React.DependencyList;
};

/**
 * Fast-entry helper: after dependent selections are satisfied, move focus to the next actionable input.
 * Pairs with {@link useFastEntryForm} (initial field) + optional Enter-as-Tab behavior.
 */
export function useDependentFieldFocus({ targetRef, enabled, deps }: UseDependentFieldFocusOpts) {
  React.useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(() => {
      const el = targetRef.current;
      if (el && typeof el.focus === "function") el.focus();
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls deps array
  }, [enabled, targetRef, ...deps]);
}
