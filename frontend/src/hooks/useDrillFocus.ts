import * as React from "react";
import {
  DRILL_DATA,
  DRILL_FOCUS_HIGHLIGHT_CLASS,
  DRILL_FOCUS_HIGHLIGHT_MS,
} from "../lib/drillDownRoutes";

export type DrillFocusDataAttribute = (typeof DRILL_DATA)[keyof typeof DRILL_DATA];

function highlightClassTokens(): string[] {
  return DRILL_FOCUS_HIGHLIGHT_CLASS.split(/\s+/).filter(Boolean);
}

/**
 * After landing with a drill query param: scroll matching `[data-*]="id"` into view,
 * apply a short-lived ring highlight, then remove classes.
 * At most one successful focus per (attribute, id) while the target stays in the DOM; if the
 * node disappears (e.g. filtered out) and later reappears (e.g. “Show …”), focus runs again.
 * Retries when `retryDeps` change if the element was not found yet.
 */
export function useDrillFocus(options: {
  attribute: DrillFocusDataAttribute;
  id: number;
  /** True once async data needed to render the target has finished loading. */
  ready: boolean;
  enabled?: boolean;
  /** e.g. [rows.length, grnPoId] so we retry after DOM updates. */
  retryDeps?: ReadonlyArray<unknown>;
}): void {
  const { attribute, id, ready, enabled = true, retryDeps = [] } = options;
  const sessionKey = `${attribute}:${id}`;
  const appliedSessionRef = React.useRef<string | null>(null);
  const timersRef = React.useRef<{ layout?: number; remove?: number }>({});

  React.useEffect(() => {
    appliedSessionRef.current = null;
  }, [attribute, id]);

  React.useEffect(() => {
    if (!id || !ready || !enabled) return;
    if (appliedSessionRef.current === sessionKey) {
      const stillThere = document.querySelector(`[${attribute}="${id}"]`);
      if (stillThere) return;
      appliedSessionRef.current = null;
    }

    if (timersRef.current.layout != null) {
      window.clearTimeout(timersRef.current.layout);
      timersRef.current.layout = undefined;
    }

    const tokens = highlightClassTokens();

    const tryFocus = () => {
      const el = document.querySelector(`[${attribute}="${id}"]`) as HTMLElement | null;
      if (!el) return false;
      appliedSessionRef.current = sessionKey;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add(...tokens);
      timersRef.current.remove = window.setTimeout(() => {
        el.classList.remove(...tokens);
        timersRef.current.remove = undefined;
      }, DRILL_FOCUS_HIGHLIGHT_MS);
      return true;
    };

    timersRef.current.layout = window.setTimeout(() => {
      requestAnimationFrame(() => {
        tryFocus();
      });
    }, 100);

    /* Only clear the scroll attempt timer here; let the highlight removal timer finish so the ring is not stuck on. */
    return () => {
      if (timersRef.current.layout != null) {
        window.clearTimeout(timersRef.current.layout);
        timersRef.current.layout = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retryDeps is intentionally spread
  }, [attribute, id, ready, enabled, sessionKey, ...retryDeps]);
}
