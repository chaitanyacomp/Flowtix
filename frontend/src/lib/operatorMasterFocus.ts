/**
 * Operator Master focus helpers — mirrors Machine Master focus behaviour.
 */

export type OperatorFocusTarget =
  | "operator-code"
  | "operator-name"
  | "employee-number";

export type OperatorFocusIntent = {
  target: OperatorFocusTarget;
  select?: boolean;
  force: boolean;
};

export function isOperatorCodeEditable(_mode: "new" | "edit"): boolean {
  return true;
}

export function firstEditableFocusTarget(mode: "new" | "edit"): OperatorFocusTarget {
  return isOperatorCodeEditable(mode) ? "operator-code" : "operator-name";
}

export function isDuplicateOperatorCodeError(message: string): boolean {
  return /operator code already exists/i.test(String(message ?? ""));
}

export function isDuplicateEmployeeNumberError(message: string): boolean {
  return /employee number already exists/i.test(String(message ?? ""));
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
  intent: OperatorFocusIntent,
  active: Element | null,
  intended: HTMLElement | null,
): boolean {
  if (intent.force) return false;
  if (!active) return false;
  if (typeof document !== "undefined" && active === document.body) return false;
  if (intended && (active === intended || intended.contains(active))) return false;
  return isInteractiveControl(active);
}

export type OperatorFocusElements = {
  code: HTMLInputElement | null;
  name: HTMLInputElement | null;
  employeeNumber: HTMLInputElement | null;
};

export function resolveOperatorFocusElement(
  target: OperatorFocusTarget,
  els: OperatorFocusElements,
): HTMLInputElement | null {
  if (target === "operator-code") return els.code;
  if (target === "operator-name") return els.name;
  return els.employeeNumber;
}

export function applyOperatorFocus(
  intent: OperatorFocusIntent,
  els: OperatorFocusElements,
  active: Element | null = typeof document !== "undefined" ? document.activeElement : null,
): boolean {
  const intended = resolveOperatorFocusElement(intent.target, els);
  if (!intended) return false;
  if (shouldSkipFocusSteal(intent, active, intended)) return false;
  intended.focus();
  if (
    intent.select &&
    intent.target === "operator-code" &&
    typeof intended.select === "function"
  ) {
    intended.select();
  }
  return true;
}
