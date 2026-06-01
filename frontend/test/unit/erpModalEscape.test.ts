import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearErpModalStackForTests,
  registerErpModal,
  shouldDeferErpModalEscape,
  tryCloseTopErpModal,
} from "../../src/lib/erpModalEscape";

describe("erpModalEscape", () => {
  afterEach(() => {
    clearErpModalStackForTests();
  });

  it("closes only the topmost modal", () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();
    const unregParent = registerErpModal(parentClose);
    registerErpModal(childClose);

    expect(tryCloseTopErpModal()).toBe(true);
    expect(childClose).toHaveBeenCalledTimes(1);
    expect(parentClose).not.toHaveBeenCalled();

    unregParent();
  });

  it("respects disabled escape on top modal", () => {
    const onClose = vi.fn();
    registerErpModal(onClose, { disabled: () => true });
    expect(tryCloseTopErpModal()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("defers when dropdown marker is open", () => {
    const marker = document.createElement("div");
    marker.setAttribute("data-erp-dropdown-open", "true");
    document.body.appendChild(marker);
    try {
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      Object.defineProperty(event, "target", { value: document.body });
      expect(shouldDeferErpModalEscape(event)).toBe(true);
    } finally {
      marker.remove();
    }
  });

  it("defers when event defaultPrevented", () => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    expect(shouldDeferErpModalEscape(event)).toBe(true);
  });
});
