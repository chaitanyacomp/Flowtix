import * as React from "react";

/**
 * When `open` becomes true, remembers the previously focused element.
 * When `open` becomes false, restores focus if that element is still connected.
 * Pair with explicit initial focus inside the modal on open.
 */
export function useModalFocusRestore(open: boolean) {
  const returnElRef = React.useRef<Element | null>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    const ae = document.activeElement;
    returnElRef.current = ae instanceof Element ? ae : null;
  }, [open]);

  React.useEffect(() => {
    if (open) return;
    const el = returnElRef.current;
    returnElRef.current = null;
    if (!(el instanceof HTMLElement)) return;
    const id = window.requestAnimationFrame(() => {
      try {
        if (document.contains(el)) el.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);
}
