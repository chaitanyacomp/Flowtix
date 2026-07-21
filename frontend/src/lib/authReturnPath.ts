/**
 * Post-login deep-link restore.
 * Stores only internal path+search (+hash); never tokens or form payloads.
 */

export const ERP_POST_LOGIN_RETURN_KEY = "erp:postLoginReturnPath";

/** Safe default after login when no valid returnTo is available. */
export const ROLE_LANDING_PATH = "/dashboard";

const BLOCKED_EXACT = new Set(["/login", "/logout"]);
const BLOCKED_PREFIXES = ["/login/", "/logout/"];

/** Dangerous URI schemes if they appear as a path segment after decode. */
const BLOCKED_SCHEME = /^(javascript|data|vbscript|blob):/i;

/** In-memory fallback when sessionStorage is unavailable (tests / private mode). */
const memoryStore = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    if (typeof sessionStorage !== "undefined") {
      return sessionStorage.getItem(key);
    }
  } catch {
    /* fall through */
  }
  return memoryStore.get(key) ?? null;
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(key, value);
      return;
    }
  } catch {
    /* fall through */
  }
  memoryStore.set(key, value);
}

function storageRemove(key: string): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
  memoryStore.delete(key);
}

function tryDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Coarse role gates for post-login `returnTo` clamping.
 * Full enforcement remains in ProtectedRoute; this avoids landing on known forbidden shells.
 */
const ROLE_GATED_PREFIXES: Array<{ prefix: string; roles: readonly string[] }> = [
  { prefix: "/account", roles: ["ADMIN"] },
  { prefix: "/activity", roles: ["ADMIN"] },
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/masters", roles: ["ADMIN"] },
  { prefix: "/database-cleanup", roles: ["ADMIN"] },
  { prefix: "/backup-restore", roles: ["ADMIN"] },
  { prefix: "/company-profile", roles: ["ADMIN"] },
  { prefix: "/admin-settings", roles: ["ADMIN"] },
];

/**
 * Accept only same-origin relative paths suitable for SPA navigate().
 * Rejects protocol-relative URLs, absolute URLs, login/logout loops, and script-like schemes.
 */
export function isSafeInternalReturnPath(raw: string | null | undefined): raw is string {
  if (raw == null) return false;
  const path = String(raw).trim();
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  if (path.includes("\\")) return false;

  const decoded = tryDecodeURIComponent(path);
  if (decoded.startsWith("//") || decoded.includes("://") || BLOCKED_SCHEME.test(decoded)) {
    return false;
  }

  const pathname = (decoded.split(/[?#]/)[0] || "/").toLowerCase();
  if (BLOCKED_EXACT.has(pathname)) return false;
  if (BLOCKED_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  if (BLOCKED_SCHEME.test(pathname.slice(1))) return false;
  return true;
}

/** Whether `role` may open this internal path as a post-login destination. */
export function isReturnPathAllowedForRole(path: string, role: string | null | undefined): boolean {
  if (!isSafeInternalReturnPath(path)) return false;
  if (role == null || !String(role).trim()) return false;
  const roleNorm = String(role).trim().toUpperCase();
  const pathname = (path.split(/[?#]/)[0] || "/").toLowerCase();
  for (const gate of ROLE_GATED_PREFIXES) {
    if (pathname === gate.prefix || pathname.startsWith(`${gate.prefix}/`)) {
      return gate.roles.some((r) => r.toUpperCase() === roleNorm);
    }
  }
  return true;
}

export function capturePostLoginReturnPath(pathWithSearch: string): void {
  if (!isSafeInternalReturnPath(pathWithSearch)) return;
  storageSet(ERP_POST_LOGIN_RETURN_KEY, pathWithSearch);
}

/** Read without clearing (e.g. Login page initial render). */
export function peekPostLoginReturnPath(): string | null {
  const raw = storageGet(ERP_POST_LOGIN_RETURN_KEY);
  return isSafeInternalReturnPath(raw) ? raw : null;
}

export function consumePostLoginReturnPath(): string | null {
  const next = peekPostLoginReturnPath();
  storageRemove(ERP_POST_LOGIN_RETURN_KEY);
  return next;
}

export function clearPostLoginReturnPath(): void {
  storageRemove(ERP_POST_LOGIN_RETURN_KEY);
}

/** Build `/login?returnTo=…` for Navigate / location.replace. */
export function loginPathWithReturn(pathWithSearch: string): string {
  if (!isSafeInternalReturnPath(pathWithSearch)) return "/login";
  return `/login?returnTo=${encodeURIComponent(pathWithSearch)}`;
}

export type ResolvePostLoginOptions = {
  /** When set, clamp role-gated paths the user cannot open to the role landing page. */
  role?: string | null;
  /** Authorized landing returned by the login API. */
  landingPath?: string | null;
};

/**
 * Resolve where to send the user after a successful login.
 * Prefer explicit query `returnTo`, then session capture, else role landing (`/dashboard`).
 */
export function resolvePostLoginDestination(
  returnToQuery: string | null | undefined,
  options?: ResolvePostLoginOptions,
): string {
  const role = options?.role ?? null;
  const pick = (candidate: string | null): string | null => {
    if (!candidate || !isSafeInternalReturnPath(candidate)) return null;
    if (role != null && !isReturnPathAllowedForRole(candidate, role)) return null;
    return candidate;
  };

  const fromQuery = returnToQuery != null ? String(returnToQuery).trim() : "";
  const queryPick = pick(fromQuery || null);
  if (queryPick) {
    clearPostLoginReturnPath();
    return queryPick;
  }
  const fromSession = consumePostLoginReturnPath();
  const sessionPick = pick(fromSession);
  if (sessionPick) return sessionPick;
  const landing = pick(options?.landingPath ? String(options.landingPath).trim() : null);
  return landing ?? ROLE_LANDING_PATH;
}
