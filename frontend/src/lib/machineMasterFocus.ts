/**
 * Machine Master focus helpers — programmatic focus after render without positive tabindex.
 */

export type MachineFocusTarget = "machine-code" | "machine-name" | "machine-type";

export type MachineFocusIntent = {
  target: MachineFocusTarget;
  /** Select input contents (duplicate-code recovery). */
  select?: boolean;
  /**
   * When true, always apply (New / edit / save / validation).
   * When false, skip if the user already focused another interactive control.
   */
  force: boolean;
};

/** Step 1: code is editable in New and Edit; reserved for future locks. */
export function isMachineCodeEditable(_mode: "new" | "edit"): boolean {
  return true;
}

export function firstEditableFocusTarget(mode: "new" | "edit"): MachineFocusTarget {
  return isMachineCodeEditable(mode) ? "machine-code" : "machine-name";
}

export function isDuplicateMachineCodeError(message: string): boolean {
  return /machine code already exists/i.test(String(message ?? ""));
}

export function isInteractiveControl(el: Element | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const node = el as HTMLElement;
  const tag = node.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return true;
  if (node.isContentEditable) return true;
  const role = typeof node.getAttribute === "function" ? node.getAttribute("role") : null;
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

/** Soft focus must not yank away from another control the user is already using. */
export function shouldSkipFocusSteal(
  intent: MachineFocusIntent,
  active: Element | null,
  intended: HTMLElement | null,
): boolean {
  if (intent.force) return false;
  if (!active) return false;
  if (typeof document !== "undefined" && active === document.body) return false;
  if (intended && (active === intended || intended.contains(active))) return false;
  return isInteractiveControl(active);
}

export type MachineFocusElements = {
  code: HTMLInputElement | null;
  name: HTMLInputElement | null;
  type: HTMLSelectElement | null;
};

export function resolveMachineFocusElement(
  target: MachineFocusTarget,
  els: MachineFocusElements,
): HTMLInputElement | HTMLSelectElement | null {
  if (target === "machine-code") return els.code;
  if (target === "machine-name") return els.name;
  return els.type;
}

/**
 * Apply a focus intent. Returns true when focus was applied.
 * Call after form/data render (e.g. rAF / effect).
 */
export function applyMachineFocus(
  intent: MachineFocusIntent,
  els: MachineFocusElements,
  active: Element | null = typeof document !== "undefined" ? document.activeElement : null,
): boolean {
  const intended = resolveMachineFocusElement(intent.target, els);
  if (!intended) return false;
  if (shouldSkipFocusSteal(intent, active, intended)) return false;
  intended.focus();
  if (
    intent.select &&
    intent.target === "machine-code" &&
    typeof (intended as HTMLInputElement).select === "function"
  ) {
    (intended as HTMLInputElement).select();
  }
  return true;
}
