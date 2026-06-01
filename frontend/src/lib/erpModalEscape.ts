/**
 * Global ERP modal stack — Escape closes the topmost registered modal only.
 * Register via {@link ErpModal} or {@link registerErpModal}.
 */

type ModalEntry = {
  id: number;
  onClose: () => void;
  disabled?: () => boolean;
};

let stack: ModalEntry[] = [];
let nextId = 0;
let listenerInstalled = false;

export function registerErpModal(onClose: () => void, options?: { disabled?: () => boolean }): () => void {
  const id = ++nextId;
  const entry: ModalEntry = { id, onClose, disabled: options?.disabled };
  stack.push(entry);
  ensureListener();
  return () => {
    stack = stack.filter((e) => e.id !== id);
  };
}

/** Close the topmost modal if any; returns true when a close handler ran. */
export function tryCloseTopErpModal(): boolean {
  const top = stack[stack.length - 1];
  if (!top || top.disabled?.()) return false;
  top.onClose();
  return true;
}

/**
 * When true, the global Escape handler should not close the modal yet
 * (dropdown search, listbox, etc. should consume Escape first).
 */
export function shouldDeferErpModalEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape") return false;
  if (event.defaultPrevented) return true;

  const target = event.target;
  if (!(target instanceof Element)) return false;

  const active = document.activeElement;
  if (active instanceof Element) {
    const expandedHost = active.closest('[aria-expanded="true"]');
    if (
      expandedHost &&
      (expandedHost.getAttribute("role") === "combobox" ||
        expandedHost.hasAttribute("aria-controls") ||
        expandedHost.matches("[data-erp-combobox]"))
    ) {
      return true;
    }
  }

  if (document.querySelector('[data-erp-dropdown-open="true"]')) {
    return true;
  }

  const openListbox = document.querySelector('[role="listbox"]:not([hidden])');
  if (openListbox && target.closest('[role="combobox"], [role="listbox"], [aria-haspopup="listbox"]')) {
    return true;
  }

  const openMenu = document.querySelector('[role="menu"]:not([hidden])');
  if (openMenu && target.closest('[role="menu"], [aria-haspopup="menu"]')) {
    return true;
  }

  return false;
}

/** @internal test helper */
export function clearErpModalStackForTests(): void {
  stack = [];
}

/** @internal test helper */
export function getErpModalStackDepthForTests(): number {
  return stack.length;
}

function onDocumentKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.ctrlKey || event.altKey || event.metaKey) return;
  if (stack.length === 0) return;
  if (shouldDeferErpModalEscape(event)) return;

  const top = stack[stack.length - 1];
  if (!top || top.disabled?.()) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  top.onClose();
}

function ensureListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  document.addEventListener("keydown", onDocumentKeyDown, true);
}

/** Call once at app bootstrap (see main.tsx). */
export function installErpModalEscapeListener(): void {
  ensureListener();
}
