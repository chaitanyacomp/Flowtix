import * as React from "react";

type UseFastEntryFormOpts = {
  /** The form/container that owns the inputs. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Optional first logical field to focus on mount. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
};

function isFocusable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  if (el instanceof HTMLInputElement && el.type === "hidden") return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

function focusableIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const nodes = Array.from(
    container.querySelectorAll(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
    ),
  );
  return nodes.filter(isFocusable);
}

function shouldEnterActAsTab(target: EventTarget | null): target is HTMLInputElement | HTMLSelectElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return false;
  if (target instanceof HTMLButtonElement) return false;

  if (target instanceof HTMLInputElement) {
    const t = (target.type || "").toLowerCase();
    if (t === "button" || t === "submit" || t === "reset") return false;
    // Keep expected behavior for checkboxes/radios.
    if (t === "checkbox" || t === "radio") return false;
    return true;
  }
  if (target instanceof HTMLSelectElement) return true;
  return false;
}

function isNumericLikeInput(target: EventTarget | null): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement)) return false;
  const type = (target.type || "").toLowerCase();
  if (type === "number") return true;
  const mode = (target.inputMode || "").toLowerCase();
  return mode === "decimal" || mode === "numeric";
}

/**
 * UX helper for fast keyboard data entry:
 * - auto-focus first logical field (optional)
 * - auto-select numeric values on Tab from another field in the same form (overwrite-friendly; avoids caret jumps)
 * - Enter acts like Tab for inputs/selects (not textarea, not buttons)
 *
 * For “after prerequisites, focus the next field” (e.g. qty after SO + FG), pair with `useDependentFieldFocus`.
 */
export function useFastEntryForm({ containerRef, initialFocusRef }: UseFastEntryFormOpts) {
  React.useEffect(() => {
    const el = initialFocusRef?.current;
    if (!el) return;
    // Defer until after first paint to avoid fighting React renders.
    const t = window.setTimeout(() => {
      if (typeof el.focus === "function") el.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [initialFocusRef]);

  React.useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const rootEl: HTMLElement = root;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      if (!shouldEnterActAsTab(e.target)) return;
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

      const focusables = focusableIn(rootEl);
      const cur = e.target instanceof HTMLElement ? e.target : null;
      const idx = cur ? focusables.indexOf(cur) : -1;
      if (idx < 0) return;
      const next = focusables[idx + 1];
      if (!next) return; // last field: allow default (may submit)

      e.preventDefault();
      next.focus();
    }

    function onFocusIn(e: FocusEvent) {
      if (!isNumericLikeInput(e.target)) return;
      const el = e.target;
      if (!el.value) return;
      const from = e.relatedTarget;
      // Only auto-select when focus moves from another control inside this form (e.g. Tab between fields).
      // Selecting on every focusin also ran when re-entering the field in ways that fight the caret and
      // makes typing feel like the cursor jumps or the selection blinks.
      if (!(from instanceof HTMLElement) || from === el || !rootEl.contains(from)) {
        return;
      }
      // Let the focus complete before selecting; prevents selection being overridden.
      window.requestAnimationFrame(() => {
        try {
          el.select();
        } catch {
          // ignore
        }
      });
    }

    rootEl.addEventListener("keydown", onKeyDown, true);
    rootEl.addEventListener("focusin", onFocusIn, true);
    return () => {
      rootEl.removeEventListener("keydown", onKeyDown, true);
      rootEl.removeEventListener("focusin", onFocusIn, true);
    };
  }, [containerRef]);
}

