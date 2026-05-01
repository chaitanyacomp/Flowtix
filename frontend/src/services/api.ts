import {
  isAuthApiPath,
  isDemoSafeMutationsBlocked,
  notifyDemoMutationBlocked,
} from "../lib/demoSafeMode";

export type ApiError = { message: string; code?: string };

/** Thrown on non-OK responses; includes optional backend `error.code` (e.g. idempotency). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly step?: string;
  readonly backendError?: string;

  constructor(message: string, status: number, code?: string, meta?: { step?: string; backendError?: string }) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.step = meta?.step;
    this.backendError = meta?.backendError;
  }
}

const SESSION_EXPIRED_MESSAGE = "Session expired. Please login again.";
const SESSION_EXPIRED_STORAGE_KEY = "auth:sessionExpiredMessage";
let authFailureHandled = false;

function isAuthFailure(status: number, message: string): boolean {
  if (status === 401) return true;
  const m = (message || "").toLowerCase();
  return m.includes("invalid token") || m.includes("missing bearer token") || m.includes("unauthorized");
}

function handleAuthFailureOnce() {
  if (authFailureHandled) return;
  authFailureHandled = true;

  try {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  } catch {
    // ignore storage errors
  }

  try {
    sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, SESSION_EXPIRED_MESSAGE);
  } catch {
    // ignore storage errors
  }

  try {
    window.dispatchEvent(new Event("auth:logout"));
  } catch {
    // ignore
  }

  if (typeof window !== "undefined" && window.location?.pathname !== "/login") {
    window.location.replace("/login");
  }
}

/** Default backend for messages (must match vite.config.ts server.proxy target). */
const DEV_PROXY_TARGET = "http://127.0.0.1:4000";

/**
 * Normalize VITE_API_URL: no trailing slash; strip a trailing `/api` so callers can keep using paths like `/api/auth/login`.
 * Example: http://127.0.0.1:4000/api → http://127.0.0.1:4000
 */
function normalizeApiBase(raw: string): string {
  let s = raw.trim().replace(/\/+$/, "");
  if (s.endsWith("/api")) {
    s = s.slice(0, -4);
  }
  return s;
}

/**
 * API origin used to build request URLs.
 * - Dev + no VITE_API_URL: "" → relative `/api/...` (Vite proxies to backend; avoids CORS and wrong base).
 * - VITE_API_URL set: direct requests to that host (e.g. http://127.0.0.1:4000).
 * - Production + no env: "" → same-origin `/api/...`.
 */
function apiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return normalizeApiBase(String(fromEnv));
  }
  if (import.meta.env.DEV) {
    return "";
  }
  return "";
}

/** Human-readable description of how API requests are resolved (for login / diagnostics). */
export function describeApiOrigin(): string {
  const base = apiBaseUrl();
  if (base) {
    return `${base} + paths like /api/...`;
  }
  if (import.meta.env.DEV) {
    return `relative URLs /api/... (Vite proxy → ${DEV_PROXY_TARGET})`;
  }
  return "relative /api/... (same origin as this app)";
}

export function getApiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = apiBaseUrl();
  return base ? `${base}${path}` : path;
}

export function consumeSessionExpiredMessage(): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SESSION_EXPIRED_STORAGE_KEY);
    return raw;
  } catch {
    return null;
  }
}

async function parseJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const method = String(opts.method ?? "GET").toUpperCase();
  const mutates =
    method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (isDemoSafeMutationsBlocked() && mutates && !isAuthApiPath(path)) {
    notifyDemoMutationBlocked();
    try {
      window.dispatchEvent(new CustomEvent("demo:action-complete"));
    } catch {
      // ignore
    }
    return undefined as T;
  }

  const token = localStorage.getItem("token");
  const headers = new Headers(opts.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const url = getApiUrl(path);
  let res: Response;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch (cause) {
    const hint =
      import.meta.env.DEV && !apiBaseUrl()
        ? ` Start the backend on ${DEV_PROXY_TARGET.replace("http://", "")} so the Vite proxy can reach it, or set VITE_API_URL in frontend/.env to call the API directly.`
        : " Start the backend or set VITE_API_URL in frontend/.env (base URL only, do not add /api).";
    const extra = cause instanceof Error && cause.message ? ` (${cause.message})` : "";
    throw new Error(`Cannot reach the API at ${url}.${hint}${extra}`);
  }
  const data = await parseJsonSafe(res);

  if (!res.ok) {
    const errObj =
      data && typeof data === "object" && "error" in data && data.error && typeof data.error === "object"
        ? (data as { error: { message?: string; code?: string } }).error
        : null;
    const fromJson = errObj && typeof errObj.message === "string" ? errObj.message : null;
    const errCode = errObj && typeof errObj.code === "string" ? errObj.code : undefined;
    const fromHtml =
      typeof data === "string" && data.trimStart().startsWith("<")
        ? `API returned HTML (${res.status}) — wrong URL or server not running. Tried: ${url}`
        : null;
    const cleanupObj =
      data && typeof data === "object" && "message" in data && "step" in data && "error" in data
        ? (data as { message?: unknown; step?: unknown; error?: unknown })
        : null;
    const cleanupStep = cleanupObj && typeof cleanupObj.step === "string" ? cleanupObj.step : undefined;
    const cleanupError = cleanupObj && typeof cleanupObj.error === "string" ? cleanupObj.error : undefined;
    const cleanupMsg = cleanupObj && typeof cleanupObj.message === "string" ? cleanupObj.message : null;

    const msg = fromJson || cleanupMsg || fromHtml || `Request failed: ${res.status}`;

    if (isAuthFailure(res.status, msg)) {
      handleAuthFailureOnce();
      throw new ApiRequestError(SESSION_EXPIRED_MESSAGE, 401);
    }
    throw new ApiRequestError(msg, res.status, errCode, { step: cleanupStep, backendError: cleanupError });
  }
  return data as T;
}
