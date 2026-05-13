import * as React from "react";
import { DRILL_ACCESS_REQUIRED_TITLE } from "./drillAccess";
import { cn } from "./utils";

/**
 * Clicks/keys originating inside these (within the row/card) do not trigger row drill-down.
 * Add data-stop-row-click on custom controls that should not activate the row.
 */
export const NESTED_DRILL_STOP_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "label",
  "[contenteditable='true']",
  "[data-stop-row-click]",
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
].join(", ");

export function isDrillRowNestedInteractiveTarget(target: EventTarget | null, rowElement: Element): boolean {
  if (!(target instanceof Element)) return false;
  const hit = target.closest(NESTED_DRILL_STOP_SELECTOR);
  if (!hit || !rowElement.contains(hit)) return false;
  return hit !== rowElement;
}

/**
 * Base visuals for drill rows/cards: pointer, hover tint + light elevation, focus ring, smooth transition.
 * Merged into getDrillRowProps; export as DRILL_DOWN_ROW_CLASS for rare manual composition.
 */
export const DRILL_ACTIVATABLE_ROW_BASE_CLASS =
  "group cursor-pointer select-none transition-[background-color,box-shadow] duration-200 ease-out hover:bg-slate-50/90 hover:shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] active:bg-slate-100/80 focus-visible:outline-none focus-visible:bg-slate-50/90 focus-visible:ring-2 focus-visible:ring-slate-400/90 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

/** Non-interactive drill row: no pointer, no hover/focus affordance (role-aware / access denied). */
export const DRILL_ROW_INACTIVE_CLASS =
  "cursor-default select-none opacity-[0.94] transition-none hover:!bg-transparent hover:!shadow-none active:!bg-transparent focus-visible:!outline-none focus-visible:!ring-0 focus-visible:!ring-offset-0";

/** @deprecated Prefer getDrillRowProps(); kept for imports that only need the class string. */
export const DRILL_DOWN_ROW_CLASS = DRILL_ACTIVATABLE_ROW_BASE_CLASS;

export type DrillRowProps = Pick<
  React.HTMLAttributes<HTMLElement>,
  "role" | "tabIndex" | "onClick" | "onKeyDown" | "onMouseDown" | "className" | "aria-label" | "title" | "aria-disabled"
>;

/**
 * Read-only drill rows: avoid mouse clicks moving focus onto the row (focus/caret noise).
 * Keyboard Tab → row still receives focus; Enter/Space unchanged.
 */
export function suppressMouseFocusOnDrillRow(e: React.MouseEvent<HTMLElement>) {
  if (e.button !== 0) return;
  e.preventDefault();
}

/**
 * Shared props for dashboard/report table rows (or block cards) that navigate on activate.
 * When `activable` is false (e.g. role cannot use destination), no click/keyboard drill and muted affordance.
 * When true: role="button" + tabIndex={0}; Enter/Space activate; nested interactive targets are ignored.
 */
export function getDrillRowProps(options: {
  onActivate: () => void;
  /** Exposed to assistive tech when activable (and title when title omitted). */
  ariaLabel: string;
  /** Optional visible tooltip; defaults to ariaLabel when activable. */
  title?: string;
  className?: string;
  /** Default true. Set false when the user’s role cannot open the drill destination. */
  activable?: boolean;
  /** Tooltip when `activable` is false; defaults to a generic access message. */
  inactiveTitle?: string;
}): DrillRowProps {
  const { onActivate, ariaLabel, title, className, activable = true, inactiveTitle } = options;

  if (!activable) {
    return {
      className: cn(DRILL_ROW_INACTIVE_CLASS, className),
      title: inactiveTitle ?? title ?? DRILL_ACCESS_REQUIRED_TITLE,
      "aria-disabled": true,
      "aria-label": ariaLabel,
    };
  }

  return {
    role: "button",
    tabIndex: 0,
    "aria-label": ariaLabel,
    title: title ?? ariaLabel,
    className: cn(DRILL_ACTIVATABLE_ROW_BASE_CLASS, className),
    onMouseDown: suppressMouseFocusOnDrillRow,
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (isDrillRowNestedInteractiveTarget(e.target, e.currentTarget)) return;
      onActivate();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target;
      const el = t instanceof Element ? t : t instanceof Node ? (t.parentElement ?? null) : null;
      if (el && el !== e.currentTarget && isDrillRowNestedInteractiveTarget(el, e.currentTarget)) return;
      e.preventDefault();
      onActivate();
    },
  };
}
