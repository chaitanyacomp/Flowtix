import { describe, expect, it } from "vitest";
import {
  consumeListScrollPosition,
  LIST_STATE_FORBIDDEN_RESTORE_KEYS,
  saveListScrollPosition,
  sanitizeListSearchParams,
} from "../../src/lib/listNavigationState";
import {
  isSafeInternalReturnPath,
  loginPathWithReturn,
  resolvePostLoginDestination,
  clearPostLoginReturnPath,
  capturePostLoginReturnPath,
} from "../../src/lib/authReturnPath";

describe("listNavigationState", () => {
  it("saves and consumes scroll once", () => {
    saveListScrollPosition("/sales-orders", 420);
    expect(consumeListScrollPosition("/sales-orders")).toBe(420);
    expect(consumeListScrollPosition("/sales-orders")).toBeNull();
  });

  it("strips forbidden action keys from list search", () => {
    const params = new URLSearchParams("soType=NO_QTY&action=new-so&openInvoice=9&q=acme");
    const clean = sanitizeListSearchParams(params);
    expect(clean.get("soType")).toBe("NO_QTY");
    expect(clean.get("q")).toBe("acme");
    for (const k of LIST_STATE_FORBIDDEN_RESTORE_KEYS) {
      expect(clean.has(k)).toBe(false);
    }
  });
});

describe("auth return path security", () => {
  it("rejects open redirects", () => {
    expect(isSafeInternalReturnPath("//evil.test")).toBe(false);
    expect(isSafeInternalReturnPath("https://evil.test/x")).toBe(false);
    expect(isSafeInternalReturnPath("/login?next=/dashboard")).toBe(false);
    expect(loginPathWithReturn("//evil")).toBe("/login");
  });

  it("preserves internal deep links after session capture", () => {
    clearPostLoginReturnPath();
    capturePostLoginReturnPath("/dispatch?salesOrderId=12&source=no_qty_so");
    expect(resolvePostLoginDestination(null)).toBe("/dispatch?salesOrderId=12&source=no_qty_so");
  });
});
