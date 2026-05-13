/**
 * Shared wording for shortcut hints (ERP-wide). Use middle dot (·) between clauses.
 */

export const BAR_SEP = " · ";

/** One entry in the bottom shortcut bar */
export type ShortcutBarItem = { keys: string; action: string };

/** Standard field-level hints (middle dot within a hint line). */
export const FIELD_HINT_PO_SUPPLIER = "Alt+1";
export const FIELD_HINT_GRN_PO = "Alt+2 — RM PO";
export const FIELD_HINT_GRID_NAV = "↵ Next · Shift+↵ Previous · ↑↓";
export const FIELD_HINT_SAVE = "Ctrl+S Save";
export const FIELD_HINT_CONFIRM = "Ctrl+Enter Confirm";
/** Operator forms: Enter moves focus like Tab (see useFastEntryForm); skipped on search fields and fields marked data-erp-enter-default. */
export const FIELD_HINT_ENTER_NEXT = "↵ Next field";

export const FIELD_HINT_DISPATCH_SO = "Alt+1 — Sales order";
export const FIELD_HINT_DISPATCH_LINE = "Alt+2 — Item line";
export const FIELD_HINT_DISPATCH_PREPARE = "Ctrl+Enter Prepare";

export const FIELD_HINT_PROD_WO = "Alt+1 — Work order";
export const FIELD_HINT_PROD_LINE = "Alt+2 — Item line";
export const FIELD_HINT_PROD_SAVE = "Ctrl+Enter Save draft";

export const FIELD_HINT_SO_EDIT_SAVE = "Ctrl+Enter Save";
export const FIELD_HINT_SO_CREATE = "Ctrl+Enter Create";
export const FIELD_HINT_SO_EDIT_QTY = FIELD_HINT_ENTER_NEXT;
export const FIELD_HINT_SO_QUOTE_PO = "Alt+1 — PO reference";

/** Default bottom bar rows for RM Purchase / GRN (page can override). */
export const RM_PO_GRN_SHORTCUT_BAR: ShortcutBarItem[] = [
  { keys: "Alt+N", action: "New" },
  { keys: "Ctrl+S", action: "Save" },
  { keys: "Ctrl+Enter", action: "Confirm" },
  { keys: "↵", action: "Next" },
  { keys: "Shift+↵", action: "Previous" },
  { keys: "Esc", action: "Close" },
];

export const DISPATCH_SHORTCUT_BAR: ShortcutBarItem[] = [
  { keys: "Alt+1", action: "Sales order" },
  { keys: "Alt+2", action: "Item line" },
  { keys: "Ctrl+Enter", action: "Prepare" },
  { keys: "Ctrl+S", action: "Prepare" },
  { keys: "↵", action: "Next" },
  { keys: "Esc", action: "Clear alert" },
];

export const PRODUCTION_SHORTCUT_BAR: ShortcutBarItem[] = [
  { keys: "Alt+1", action: "Work order" },
  { keys: "Alt+2", action: "Item line" },
  { keys: "Ctrl+Enter", action: "Save draft" },
  { keys: "Ctrl+S", action: "Save draft" },
  { keys: "↵", action: "Next" },
  { keys: "Esc", action: "Clear alert" },
];

export const SALES_ORDERS_SHORTCUT_BAR: ShortcutBarItem[] = [
  { keys: "Alt+1", action: "PO reference" },
  { keys: "Ctrl+Enter", action: "Save" },
  { keys: "Ctrl+S", action: "Save" },
  { keys: "↵", action: "Next" },
  { keys: "Esc", action: "Close" },
];

export function formatShortcutBarLine(items: ShortcutBarItem[]): string {
  return items.map((s) => `${s.keys} ${s.action}`.trim()).join(BAR_SEP);
}
