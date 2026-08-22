/**
 * Shift Master focus helpers — mirrors Operator/Machine Master focus behaviour.
 */

export type ShiftFocusTarget = "shift-code" | "shift-name" | "start-time" | "end-time" | "break-minutes";

export type ShiftFocusIntent = {
  target: ShiftFocusTarget;
  select?: boolean;
  force: boolean;
};

export function isShiftCodeEditable(_mode: "new" | "edit"): boolean {
  return true;
}

export function firstEditableFocusTarget(mode: "new" | "edit"): ShiftFocusTarget {
  return isShiftCodeEditable(mode) ? "shift-code" : "shift-name";
}

export function isDuplicateShiftCodeError(message: string): boolean {
  return /shift code already exists/i.test(String(message ?? ""));
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
  intent: ShiftFocusIntent,
  active: Element | null,
  intended: HTMLElement | null,
): boolean {
  if (intent.force) return false;
  if (!active) return false;
  if (typeof document !== "undefined" && active === document.body) return false;
  if (intended && (active === intended || intended.contains(active))) return false;
  return isInteractiveControl(active);
}

export type ShiftFocusElements = {
  code: HTMLInputElement | null;
  name: HTMLInputElement | null;
  startTime: HTMLInputElement | null;
  endTime: HTMLInputElement | null;
  breakMinutes: HTMLInputElement | null;
};

export function resolveShiftFocusElement(
  target: ShiftFocusTarget,
  els: ShiftFocusElements,
): HTMLInputElement | null {
  if (target === "shift-code") return els.code;
  if (target === "shift-name") return els.name;
  if (target === "start-time") return els.startTime;
  if (target === "end-time") return els.endTime;
  return els.breakMinutes;
}

export function applyShiftFocus(
  intent: ShiftFocusIntent,
  els: ShiftFocusElements,
  active: Element | null = typeof document !== "undefined" ? document.activeElement : null,
): boolean {
  const intended = resolveShiftFocusElement(intent.target, els);
  if (!intended) return false;
  if (shouldSkipFocusSteal(intent, active, intended)) return false;
  intended.focus();
  if (intent.select && intent.target === "shift-code" && typeof intended.select === "function") {
    intended.select();
  }
  return true;
}
