/**
 * Shared authentication session helpers (logout, 401, bfcache, user-scoped wipe).
 * Keep side effects here so apiFetch / apiDownload / useAuth stay aligned.
 */

import { clearErpDataCache } from "./erpDataCache";
import {
  capturePostLoginReturnPath,
  clearPostLoginReturnPath,
  loginPathWithReturn,
  ROLE_LANDING_PATH,
} from "./authReturnPath";
import { LIST_SCROLL_SESSION_PREFIX } from "./listNavigationState";
import { ERP_COMMERCIAL_ORIGIN_SESSION_KEY } from "./erpBackNavigation";

export { ROLE_LANDING_PATH };

export const SESSION_EXPIRED_MESSAGE = "Session expired. Please login again.";
export const SESSION_EXPIRED_STORAGE_KEY = "auth:sessionExpiredMessage";

/** Non-destructive read so React StrictMode remounts still see the banner text. */
export function peekSessionExpiredMessage(): string | null {
  try {
    return sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Drop stored banner text (after LoginPage has established UI state, or on logout/login). */
export function clearSessionExpiredMessage(): void {
  try {
    sessionStorage.removeItem(SESSION_EXPIRED_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Destructive read (legacy). Prefer peek + clearSessionExpiredMessage after banner state is set.
 */
export function consumeSessionExpiredMessage(): string | null {
  const raw = peekSessionExpiredMessage();
  if (raw) clearSessionExpiredMessage();
  return raw;
}

/** sessionStorage keys / prefixes that must not survive logout or user switch. */
const USER_SCOPED_SESSION_EXACT_KEYS = [
  "erp:loginDashboardMark",
  ERP_COMMERCIAL_ORIGIN_SESSION_KEY,
] as const;

const USER_SCOPED_SESSION_PREFIXES = [
  LIST_SCROLL_SESSION_PREFIX,
  "erp:production-report-draft:v1:",
] as const;

export type StoredAuthUser = {
  id: number;
  email: string;
  role: string;
  name: string;
  permissions?: string[];
  landingPath?: string;
};

let authFailureHandled = false;

/** Call after successful login so a later 401 can redirect again in the same SPA session. */
export function resetAuthFailureGate(): void {
  authFailureHandled = false;
}

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

export function readStoredAuthUser(): StoredAuthUser | null {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuthUser;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "number" || typeof parsed.role !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True when JWT is missing, malformed, or past `exp` (when present). */
export function isAccessTokenUsable(token: string | null | undefined): boolean {
  if (token == null) return false;
  const t = String(token).trim();
  if (!t) return false;
  const parts = t.split(".");
  if (parts.length < 2) return false;
  try {
    const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadJson) as { exp?: unknown };
    if (typeof payload.exp === "number") {
      return payload.exp * 1000 > Date.now();
    }
    // No exp claim — treat as usable until a 401 proves otherwise.
    return true;
  } catch {
    return false;
  }
}

export function clearAuthStorage(): void {
  try {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  } catch {
    /* ignore */
  }
}

export type ClearUserScopedOptions = {
  /** Also clear post-login return capture (logout / auth failure). Default false. */
  clearReturnPath?: boolean;
};

/**
 * Drop tab-scoped UX artifacts so a later login cannot inherit prior-user UI state.
 * Does not clear `auth:sessionExpiredMessage` (LoginPage peeks then clears; intentional logout clears).
 */
export function clearUserScopedSessionArtifacts(opts?: ClearUserScopedOptions): void {
  if (opts?.clearReturnPath) clearPostLoginReturnPath();
  try {
    if (typeof sessionStorage === "undefined") return;
    for (const key of USER_SCOPED_SESSION_EXACT_KEYS) {
      sessionStorage.removeItem(key);
    }
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      if (USER_SCOPED_SESSION_PREFIXES.some((p) => key === p || key.startsWith(p))) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export type ForceUnauthOptions = {
  /** Dispatch `auth:logout` so React hooks re-sync. Default true. */
  dispatchEvent?: boolean;
  /** Clear ERP in-memory data cache. Default true. */
  clearCache?: boolean;
};

/**
 * Wipe credentials + user-scoped client state. Does not navigate.
 */
export function forceUnauthenticatedState(opts?: ForceUnauthOptions): void {
  const dispatchEvent = opts?.dispatchEvent !== false;
  const clearCache = opts?.clearCache !== false;
  clearAuthStorage();
  clearUserScopedSessionArtifacts({ clearReturnPath: true });
  if (clearCache) clearErpDataCache("logout");
  if (dispatchEvent && typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event("auth:logout"));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Single 401 / session-loss path for apiFetch and apiDownload.
 * Clears auth, preserves safe returnTo, hard-redirects to login.
 */
export function handleAuthFailureOnce(): void {
  if (authFailureHandled) return;
  authFailureHandled = true;

  try {
    sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, SESSION_EXPIRED_MESSAGE);
  } catch {
    /* ignore */
  }

  forceUnauthenticatedState({ dispatchEvent: true, clearCache: true });

  if (typeof window !== "undefined" && window.location?.pathname !== "/login") {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    // Re-capture after wipe so post-login restore still works.
    capturePostLoginReturnPath(returnTo);
    window.location.replace(loginPathWithReturn(returnTo));
  }
}

/** Intentional logout: wipe + hard navigate so Back cannot resurrect SPA/bfcache state. */
export function performIntentionalLogout(): void {
  // Never surface a prior 401 banner on a voluntary sign-out.
  clearSessionExpiredMessage();
  forceUnauthenticatedState({ dispatchEvent: true, clearCache: true });
  if (typeof window !== "undefined") {
    window.location.replace("/login");
  }
}

let historyGuardInstalled = false;

/**
 * When the browser restores a protected page from bfcache after logout,
 * re-check credentials and hard-redirect before protected UI can interact.
 */
export function installAuthHistoryGuard(): void {
  if (historyGuardInstalled || typeof window === "undefined") return;
  historyGuardInstalled = true;

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    const token = readStoredToken();
    if (isAccessTokenUsable(token) && readStoredAuthUser()) return;
    forceUnauthenticatedState({ dispatchEvent: true, clearCache: true });
    if (window.location.pathname !== "/login") {
      window.location.replace("/login");
    }
  });
}
