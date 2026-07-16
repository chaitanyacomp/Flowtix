import { describe, expect, it } from "vitest";
import {
  capturePostLoginReturnPath,
  clearPostLoginReturnPath,
  consumePostLoginReturnPath,
  isSafeInternalReturnPath,
  loginPathWithReturn,
  resolvePostLoginDestination,
  ERP_POST_LOGIN_RETURN_KEY,
  ROLE_LANDING_PATH,
} from "../../src/lib/authReturnPath";
import { confirmLeaveIfDirty } from "../../src/lib/unsavedChangesPolicy";

describe("authReturnPath", () => {
  it("accepts only safe internal paths", () => {
    expect(isSafeInternalReturnPath("/sales-orders/242/requirement-sheets?sheetId=379")).toBe(true);
    expect(isSafeInternalReturnPath("/dashboard")).toBe(true);
    expect(isSafeInternalReturnPath("/login")).toBe(false);
    expect(isSafeInternalReturnPath("//evil.example")).toBe(false);
    expect(isSafeInternalReturnPath("https://evil.example/")).toBe(false);
    expect(isSafeInternalReturnPath("dashboard")).toBe(false);
  });

  it("builds login path with returnTo", () => {
    expect(loginPathWithReturn("/dispatch?salesOrderId=1")).toBe(
      "/login?returnTo=%2Fdispatch%3FsalesOrderId%3D1",
    );
  });

  it("prefers query returnTo then session then dashboard", () => {
    clearPostLoginReturnPath();
    capturePostLoginReturnPath("/work-orders");
    expect(resolvePostLoginDestination("/qc-entry?workOrderId=9")).toBe("/qc-entry?workOrderId=9");
    capturePostLoginReturnPath("/work-orders");
    expect(resolvePostLoginDestination(null)).toBe("/work-orders");
    expect(resolvePostLoginDestination(null)).toBe(ROLE_LANDING_PATH);
  });

  it("consume clears session key", () => {
    capturePostLoginReturnPath("/production");
    expect(consumePostLoginReturnPath()).toBe("/production");
    expect(consumePostLoginReturnPath()).toBeNull();
    expect(ERP_POST_LOGIN_RETURN_KEY).toMatch(/^erp:/);
  });
});

describe("unsavedChangesPolicy", () => {
  it("allows leave when clean", () => {
    expect(confirmLeaveIfDirty(false)).toBe(true);
  });

  it("asks confirm when dirty when window.confirm exists", () => {
    const g = globalThis as typeof globalThis & { window?: Window; confirm?: (m?: string) => boolean };
    const prevWindow = g.window;
    let called = false;
    g.window = {
      confirm: () => {
        called = true;
        return false;
      },
    } as unknown as Window;
    try {
      expect(confirmLeaveIfDirty(true, "Leave?")).toBe(false);
      expect(called).toBe(true);
    } finally {
      g.window = prevWindow;
    }
  });
});
