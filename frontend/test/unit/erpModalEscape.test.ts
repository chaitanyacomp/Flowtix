import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearErpModalStackForTests,
  registerErpModal,
  shouldDeferErpModalEscape,
  tryCloseTopErpModal,
} from "../../src/lib/erpModalEscape";

describe("erpModalEscape", () => {
  class FakeElement {
    closest() {
      return null;
    }
  }

  const fakeDocument = {
    addEventListener: vi.fn(),
    querySelector: vi.fn(() => null as Element | null),
    activeElement: null,
  };

  beforeEach(() => {
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("Element", FakeElement);
    fakeDocument.querySelector.mockReturnValue(null);
  });

  afterEach(() => {
    clearErpModalStackForTests();
    vi.unstubAllGlobals();
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
    fakeDocument.querySelector.mockReturnValue({} as Element);
    const event = {
      key: "Escape",
      defaultPrevented: false,
      target: new FakeElement(),
    } as unknown as KeyboardEvent;
    expect(shouldDeferErpModalEscape(event)).toBe(true);
  });

  it("defers when event defaultPrevented", () => {
    const event = { key: "Escape", defaultPrevented: true, target: null } as KeyboardEvent;
    expect(shouldDeferErpModalEscape(event)).toBe(true);
  });
});
