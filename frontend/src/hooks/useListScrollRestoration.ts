import * as React from "react";
import { useLocation } from "react-router-dom";
import { consumeListScrollPosition, saveListScrollPosition } from "../lib/listNavigationState";

/**
 * Saves window scroll on unmount; restores once after mount when a prior
 * visit to this pathname left a session scroll mark (List → Record → Back).
 */
export function useListScrollRestoration(enabled = true) {
  const { pathname } = useLocation();

  React.useEffect(() => {
    if (!enabled) return;
    const y = consumeListScrollPosition(pathname);
    if (y == null || y <= 0) return;
    const t = window.requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(t);
  }, [pathname, enabled]);

  React.useEffect(() => {
    if (!enabled) return;
    return () => {
      saveListScrollPosition(pathname, window.scrollY || document.documentElement.scrollTop || 0);
    };
  }, [pathname, enabled]);
}
