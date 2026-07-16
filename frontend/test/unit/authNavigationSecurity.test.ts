import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  capturePostLoginReturnPath,
  clearPostLoginReturnPath,
  consumePostLoginReturnPath,
  isReturnPathAllowedForRole,
  isSafeInternalReturnPath,
  loginPathWithReturn,
  resolvePostLoginDestination,
  ROLE_LANDING_PATH,
  ERP_POST_LOGIN_RETURN_KEY,
} from "../../src/lib/authReturnPath";
import {
  clearUserScopedSessionArtifacts,
  forceUnauthenticatedState,
  handleAuthFailureOnce,
  isAccessTokenUsable,
  resetAuthFailureGate,
  SESSION_EXPIRED_STORAGE_KEY,
} from "../../src/lib/authSession";
import { LIST_SCROLL_SESSION_PREFIX } from "../../src/lib/listNavigationState";

function b64url(obj: object): string {
  const json = JSON.stringify(obj);
  const b64 = Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = b64url({ alg: "none", typ: "JWT" });
  const payload = b64url({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow });
  return `${header}.${payload}.sig`;
}

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe("auth return path security", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    clearPostLoginReturnPath();
    resetAuthFailureGate();
  });

  afterEach(() => {
    clearPostLoginReturnPath();
    resetAuthFailureGate();
    vi.unstubAllGlobals();
  });

  it("rejects open redirects and unsafe schemes", () => {
    expect(isSafeInternalReturnPath("https://evil.example/x")).toBe(false);
    expect(isSafeInternalReturnPath("//evil.example")).toBe(false);
    expect(isSafeInternalReturnPath("/\\evil")).toBe(false);
    expect(isSafeInternalReturnPath("javascript:alert(1)")).toBe(false);
    expect(isSafeInternalReturnPath("/javascript:alert(1)")).toBe(false);
    expect(isSafeInternalReturnPath("/data:text/html,hi")).toBe(false);
    expect(loginPathWithReturn("//evil")).toBe("/login");
    expect(loginPathWithReturn("https://evil.test")).toBe("/login");
  });

  it("rejects login/logout loop targets", () => {
    expect(isSafeInternalReturnPath("/login")).toBe(false);
    expect(isSafeInternalReturnPath("/login?next=/dashboard")).toBe(false);
    expect(isSafeInternalReturnPath("/logout")).toBe(false);
    expect(isSafeInternalReturnPath("/logout/done")).toBe(false);
  });

  it("accepts safe internal deep links", () => {
    expect(isSafeInternalReturnPath("/dispatch?salesOrderId=1")).toBe(true);
    expect(isSafeInternalReturnPath("/sales-orders/242/requirement-sheets?sheetId=379")).toBe(true);
    expect(loginPathWithReturn("/dispatch?salesOrderId=1")).toBe(
      "/login?returnTo=%2Fdispatch%3FsalesOrderId%3D1",
    );
  });

  it("clamps unauthorized ERP admin routes to role landing for non-admin", () => {
    expect(isReturnPathAllowedForRole("/account", "QA")).toBe(false);
    expect(isReturnPathAllowedForRole("/admin/rate-contracts", "STORE")).toBe(false);
    expect(isReturnPathAllowedForRole("/account", "ADMIN")).toBe(true);
    expect(resolvePostLoginDestination("/account", { role: "QA" })).toBe(ROLE_LANDING_PATH);
    expect(resolvePostLoginDestination("/dispatch", { role: "STORE" })).toBe("/dispatch");
  });

  it("prefers query returnTo then session then role landing", () => {
    capturePostLoginReturnPath("/work-orders");
    expect(resolvePostLoginDestination("/qc-entry?workOrderId=9", { role: "QA" })).toBe(
      "/qc-entry?workOrderId=9",
    );
    capturePostLoginReturnPath("/work-orders");
    expect(resolvePostLoginDestination(null, { role: "PRODUCTION" })).toBe("/work-orders");
    expect(resolvePostLoginDestination(null, { role: "PRODUCTION" })).toBe(ROLE_LANDING_PATH);
  });

  it("ignores unsafe query and falls back safely", () => {
    capturePostLoginReturnPath("/production");
    expect(resolvePostLoginDestination("//evil", { role: "ADMIN" })).toBe("/production");
    expect(resolvePostLoginDestination("javascript:alert(1)", { role: "ADMIN" })).toBe(
      ROLE_LANDING_PATH,
    );
  });
});

describe("auth session wipe and 401", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    resetAuthFailureGate();
    const location = {
      pathname: "/dispatch",
      search: "?salesOrderId=3",
      hash: "",
      replace: vi.fn(),
    };
    vi.stubGlobal("location", location);
    vi.stubGlobal("window", {
      location,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetAuthFailureGate();
  });

  it("treats expired JWT as unusable", () => {
    expect(isAccessTokenUsable(makeJwt(-60))).toBe(false);
    expect(isAccessTokenUsable(makeJwt(3600))).toBe(true);
    expect(isAccessTokenUsable("not-a-jwt")).toBe(false);
  });

  it("clears user-scoped session artifacts on wipe", () => {
    sessionStorage.setItem(`${LIST_SCROLL_SESSION_PREFIX}/sales-orders`, "120");
    sessionStorage.setItem("erp:loginDashboardMark", "1");
    sessionStorage.setItem(ERP_POST_LOGIN_RETURN_KEY, "/dashboard");
    localStorage.setItem("token", "t");
    localStorage.setItem("user", JSON.stringify({ id: 1, email: "a@b.c", role: "ADMIN", name: "A" }));

    forceUnauthenticatedState({ dispatchEvent: false });

    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    expect(sessionStorage.getItem(`${LIST_SCROLL_SESSION_PREFIX}/sales-orders`)).toBeNull();
    expect(sessionStorage.getItem("erp:loginDashboardMark")).toBeNull();
    expect(sessionStorage.getItem(ERP_POST_LOGIN_RETURN_KEY)).toBeNull();
  });

  it("login-scoped clear keeps post-login return for resolve", () => {
    capturePostLoginReturnPath("/material-issue");
    clearUserScopedSessionArtifacts();
    expect(consumePostLoginReturnPath()).toBe("/material-issue");
  });

  it("handleAuthFailureOnce redirects with safe returnTo once", () => {
    localStorage.setItem("token", "t");
    localStorage.setItem("user", JSON.stringify({ id: 1, email: "a@b.c", role: "STORE", name: "S" }));

    handleAuthFailureOnce();
    handleAuthFailureOnce();

    expect(localStorage.getItem("token")).toBeNull();
    expect(sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY)).toBeTruthy();
    expect(window.location.replace).toHaveBeenCalledTimes(1);
    expect(window.location.replace).toHaveBeenCalledWith(
      "/login?returnTo=%2Fdispatch%3FsalesOrderId%3D3",
    );
  });
});
