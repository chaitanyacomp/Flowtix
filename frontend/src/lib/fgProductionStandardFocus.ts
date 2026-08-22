/**
 * FG Production Standard focus helpers — mirrors Shift/Machine Master focus behaviour.
 */

export type FgStandardFocusTarget =
  | "fg-item"
  | "machine"
  | "cycle-time"
  | "pieces"
  | "efficiency"
  | "preview-shift";

export type FgStandardFocusIntent = {
  target: FgStandardFocusTarget;
  select?: boolean;
  force: boolean;
};

export function firstEditableFocusTarget(_mode: "new" | "edit"): FgStandardFocusTarget {
  return "fg-item";
}

export function isDuplicateFgMachineError(message: string): boolean {
  return /already exists for this fg and machine/i.test(String(message ?? ""));
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

export function shouldSkipFocusSteal(
  intent: FgStandardFocusIntent,
  active: Element | null,
  intended: HTMLElement | null,
): boolean {
  if (intent.force) return false;
  if (!active) return false;
  if (typeof document !== "undefined" && active === document.body) return false;
  if (intended && (active === intended || intended.contains(active))) return false;
  return isInteractiveControl(active);
}

export type FgStandardFocusElements = {
  fgItem: HTMLSelectElement | HTMLInputElement | null;
  machine: HTMLSelectElement | HTMLInputElement | null;
  cycleTime: HTMLInputElement | null;
  pieces: HTMLInputElement | null;
  efficiency: HTMLInputElement | null;
  previewShift: HTMLSelectElement | HTMLInputElement | null;
};

export function resolveFgStandardFocusElement(
  target: FgStandardFocusTarget,
  els: FgStandardFocusElements,
): HTMLElement | null {
  if (target === "fg-item") return els.fgItem;
  if (target === "machine") return els.machine;
  if (target === "cycle-time") return els.cycleTime;
  if (target === "pieces") return els.pieces;
  if (target === "efficiency") return els.efficiency;
  return els.previewShift;
}

export function applyFgStandardFocus(
  intent: FgStandardFocusIntent,
  els: FgStandardFocusElements,
  active: Element | null = typeof document !== "undefined" ? document.activeElement : null,
): boolean {
  const intended = resolveFgStandardFocusElement(intent.target, els);
  if (!intended) return false;
  if (shouldSkipFocusSteal(intent, active, intended)) return false;
  intended.focus();
  if (
    intent.select &&
    intent.target === "cycle-time" &&
    typeof (intended as HTMLInputElement).select === "function"
  ) {
    (intended as HTMLInputElement).select();
  }
  return true;
}
