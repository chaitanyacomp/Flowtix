import * as React from "react";
import { prefersFinePointer } from "../lib/erpFocus";

type UseFastEntryFormOpts = {
  /** The form/container that owns the inputs. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Optional first logical field to focus on mount. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * When false, skips programmatic initial focus (e.g. prerequisites not ready).
   * Default true when `initialFocusRef` is set.
   */
  initialFocusEnabled?: boolean;
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
  if (target.isContentEditable) return false;

  if (target instanceof HTMLInputElement) {
    const t = (target.type || "").toLowerCase();
    if (t === "button" || t === "submit" || t === "reset") return false;
    if (t === "checkbox" || t === "radio") return false;
    if (t === "search") return false;
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

function targetUsesDefaultEnter(el: HTMLElement): boolean {
  if (el.closest("[data-erp-enter-default]")) return true;
  if (el.getAttribute("role") === "searchbox") return true;
  return false;
}

/**
 * UX helper for fast keyboard data entry:
 * - optional auto-focus first logical field (desktop pointer only; optional gate)
 * - auto-select numeric values on Tab from another field in the same form
 * - Enter acts like Tab for inputs/selects (not textarea, not buttons, not search / `data-erp-enter-default`)
 * - Last field: Enter does not submit the form (operators use explicit save shortcuts / buttons)
 *
 * Pair with `useDependentFieldFocus` for “after prerequisites, focus next field”.
 */
export function useFastEntryForm({
  containerRef,
  initialFocusRef,
  initialFocusEnabled = true,
}: UseFastEntryFormOpts) {
  React.useEffect(() => {
    if (!initialFocusRef) return;
    if (!initialFocusEnabled) return;
    if (!prefersFinePointer()) return;
    const el = initialFocusRef.current;
    if (!el) return;
    const t = window.setTimeout(() => {
      if (typeof el.focus === "function") el.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(t);
  }, [initialFocusRef, initialFocusEnabled]);

  React.useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const rootEl: HTMLElement = root;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      if (!shouldEnterActAsTab(e.target)) return;
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && targetUsesDefaultEnter(t)) return;

      const focusables = focusableIn(rootEl);
      const cur = e.target instanceof HTMLElement ? e.target : null;
      const idx = cur ? focusables.indexOf(cur) : -1;
      if (idx < 0) return;
      const next = focusables[idx + 1];
      if (!next) {
        e.preventDefault();
        return;
      }

      e.preventDefault();
      next.focus({ preventScroll: true });
    }

    function onFocusIn(e: FocusEvent) {
      if (!isNumericLikeInput(e.target)) return;
      const el = e.target;
      if (!el.value) return;
      const from = e.relatedTarget;
      if (!(from instanceof HTMLElement) || from === el || !rootEl.contains(from)) {
        return;
      }
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
