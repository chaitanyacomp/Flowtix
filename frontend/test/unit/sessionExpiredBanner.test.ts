import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_EXPIRED_MESSAGE,
  SESSION_EXPIRED_STORAGE_KEY,
  clearSessionExpiredMessage,
  consumeSessionExpiredMessage,
  handleAuthFailureOnce,
  peekSessionExpiredMessage,
  performIntentionalLogout,
  resetAuthFailureGate,
} from "../../src/lib/authSession";

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

/**
 * Mirrors LoginPage: peek into useState initializer (twice under StrictMode),
 * then clear once the banner state is established.
 */
function loginPageBannerLifecycle(): string | null {
  const firstMount = peekSessionExpiredMessage();
  const secondMount = peekSessionExpiredMessage(); // StrictMode remount
  const sessionMessage = firstMount ?? secondMount;
  if (sessionMessage) {
    clearSessionExpiredMessage();
  }
  return sessionMessage;
}

describe("session-expiry login banner", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    resetAuthFailureGate();
    const location = {
      pathname: "/dispatch",
      search: "",
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

  it("StrictMode double mount still surfaces the session-expiry banner", () => {
    sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, SESSION_EXPIRED_MESSAGE);

    const first = peekSessionExpiredMessage();
    const second = peekSessionExpiredMessage();

    expect(first).toBe(SESSION_EXPIRED_MESSAGE);
    expect(second).toBe(SESSION_EXPIRED_MESSAGE);
    expect(loginPageBannerLifecycle()).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("destructive consume loses the message on StrictMode remount (regression guard)", () => {
    sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, SESSION_EXPIRED_MESSAGE);
    expect(consumeSessionExpiredMessage()).toBe(SESSION_EXPIRED_MESSAGE);
    expect(consumeSessionExpiredMessage()).toBeNull();
  });

  it("session-expiry banner appears after handleAuthFailureOnce", () => {
    localStorage.setItem("token", "t");
    handleAuthFailureOnce();

    expect(peekSessionExpiredMessage()).toBe(SESSION_EXPIRED_MESSAGE);
    expect(loginPageBannerLifecycle()).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("multiple simultaneous 401s still create only one logical message", () => {
    localStorage.setItem("token", "t");
    handleAuthFailureOnce();
    handleAuthFailureOnce();
    handleAuthFailureOnce();

    expect(peekSessionExpiredMessage()).toBe(SESSION_EXPIRED_MESSAGE);
    expect(window.location.replace).toHaveBeenCalledTimes(1);
  });

  it("normal logout does not show the session-expiry message", () => {
    sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, SESSION_EXPIRED_MESSAGE);
    localStorage.setItem("token", "t");

    performIntentionalLogout();

    expect(peekSessionExpiredMessage()).toBeNull();
    expect(loginPageBannerLifecycle()).toBeNull();
    expect(window.location.replace).toHaveBeenCalledWith("/login");
  });

  it("successful login clears the stored message", () => {
    sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, SESSION_EXPIRED_MESSAGE);
    // LoginPage onSubmit calls clear after auth.login succeeds.
    clearSessionExpiredMessage();
    expect(peekSessionExpiredMessage()).toBeNull();
  });

  it("message does not persist indefinitely after banner is established", () => {
    sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, SESSION_EXPIRED_MESSAGE);
    const shown = loginPageBannerLifecycle();
    expect(shown).toBe(SESSION_EXPIRED_MESSAGE);

    // Simulates Login page refresh: storage already cleared after establish.
    expect(peekSessionExpiredMessage()).toBeNull();
    expect(loginPageBannerLifecycle()).toBeNull();
  });
});
