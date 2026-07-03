/**
 * Cross-navigation ERP data cache (stale-while-revalidate).
 * Page snapshots are keyed by role + route + queryKey; API responses also keyed for dedupe + warm fallback.
 */

import type { ErpRefreshScope } from "./erpRefresh";
import { ERP_REFRESH_EVENT, type ErpRefreshEventDetail } from "./erpRefresh";

export type ErpCacheKeyParts = {
  role: string;
  route: string;
  queryKey: string;
};

export type ErpCacheEntry<T = unknown> = {
  data: T;
  error: string | null;
  updatedAt: number;
};

function normalizeRole(role: string): string {
  return String(role ?? "").trim().toUpperCase();
}

export function buildErpPageCacheKey(parts: ErpCacheKeyParts): string {
  return `${normalizeRole(parts.role)}::${parts.route}::${parts.queryKey}`;
}

/** Dedupe identical GET requests across routes for the same role. */
export function buildErpApiCacheKey(role: string, apiPath: string): string {
  return `${normalizeRole(role)}::GET::${apiPath}`;
}

const pageCache = new Map<string, ErpCacheEntry>();
const apiCache = new Map<string, ErpCacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

let cacheBoundRole: string | null = null;

export function readErpPageCache<T>(key: string): ErpCacheEntry<T> | undefined {
  return pageCache.get(key) as ErpCacheEntry<T> | undefined;
}

export function readErpApiCache<T>(key: string): ErpCacheEntry<T> | undefined {
  return apiCache.get(key) as ErpCacheEntry<T> | undefined;
}

/** Prefer page snapshot; fall back to last API response for the same role. */
export function readErpCachedData<T>(pageKey: string, apiKey: string): ErpCacheEntry<T> | undefined {
  return readErpPageCache<T>(pageKey) ?? readErpApiCache<T>(apiKey);
}

export function writeErpCache<T>(pageKey: string, apiKey: string, entry: ErpCacheEntry<T>): void {
  pageCache.set(pageKey, entry as ErpCacheEntry);
  apiCache.set(apiKey, entry as ErpCacheEntry);
}

export function deleteErpCacheKey(pageKey: string, apiKey?: string): void {
  pageCache.delete(pageKey);
  if (apiKey) apiCache.delete(apiKey);
}

/** Hard reset — logout, role change, or explicit wipe. */
export function clearErpDataCache(reason?: string): void {
  pageCache.clear();
  apiCache.clear();
  inFlight.clear();
  cacheBoundRole = null;
  if (import.meta.env.DEV && reason) {
    // eslint-disable-next-line no-console
    console.debug("[erp-cache] cleared", { reason });
  }
}

export function bindErpCacheRole(role: string | null | undefined): void {
  const next = role ? normalizeRole(role) : null;
  if (cacheBoundRole != null && next != null && cacheBoundRole !== next) {
    clearErpDataCache("role-change");
  }
  cacheBoundRole = next;
}

/** Reuse one in-flight promise for the same API key (cross-route / cross-mount). */
export async function runErpDedupedFetch<T>(apiKey: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(apiKey);
  if (existing) return existing as Promise<T>;

  const promise = fetcher().finally(() => {
    if (inFlight.get(apiKey) === promise) inFlight.delete(apiKey);
  });
  inFlight.set(apiKey, promise);
  return promise;
}

const SCOPE_API_PREFIXES: Partial<Record<ErpRefreshScope, string[]>> = {
  dashboard: ["/api/dashboard", "/api/material-availability", "/api/procurement-planning", "/api/planning-dashboard"],
  "pending-actions": ["/api/pending-actions"],
  dispatch: ["/api/dashboard/dispatch", "/api/dispatch"],
  production: ["/api/dashboard/production", "/api/production", "/api/work-orders"],
  qc: ["/api/dashboard/qc", "/api/production/qc"],
  stock: ["/api/stock", "/api/material-availability", "/api/material-issue"],
  sales: ["/api/sales-orders", "/api/sales-bills", "/api/enquir", "/api/quotation"],
  requirement: ["/api/requirement-sheet", "/api/planning-dashboard", "/api/dashboard/no-qty"],
};

const SCOPE_ROUTE_PREFIXES: Partial<Record<ErpRefreshScope, string[]>> = {
  dashboard: ["/dashboard"],
  "pending-actions": ["/pending-actions", "/dashboard"],
  dispatch: ["/dispatch", "/dashboard"],
  production: ["/production", "/dashboard"],
  qc: ["/qc-entry", "/dashboard"],
};

function cacheKeyMatchesScope(key: string, scope: ErpRefreshScope): boolean {
  if (scope === "all") return true;
  const apiPrefixes = SCOPE_API_PREFIXES[scope] ?? [];
  for (const p of apiPrefixes) {
    if (key.includes(p)) return true;
  }
  const routePrefixes = SCOPE_ROUTE_PREFIXES[scope] ?? [];
  for (const r of routePrefixes) {
    if (key.includes(`::${r}::`) || key.startsWith(`${normalizeRole(cacheBoundRole ?? "")}::${r}::`)) return true;
  }
  return false;
}

/** Drop cached snapshots for scopes affected by a mutation or explicit refresh signal. */
export function invalidateErpCacheForScopes(scopes: ErpRefreshScope[], role?: string): void {
  const roleNorm = role ? normalizeRole(role) : null;
  const targets = new Set<ErpRefreshScope>(scopes);

  for (const key of [...pageCache.keys()]) {
    if (roleNorm && !key.startsWith(`${roleNorm}::`)) continue;
    for (const scope of targets) {
      if (cacheKeyMatchesScope(key, scope)) {
        pageCache.delete(key);
        break;
      }
    }
  }
  for (const key of [...apiCache.keys()]) {
    if (roleNorm && !key.startsWith(`${roleNorm}::`)) continue;
    for (const scope of targets) {
      if (cacheKeyMatchesScope(key, scope)) {
        apiCache.delete(key);
        inFlight.delete(key);
        break;
      }
    }
  }
}

let lifecycleInstalled = false;

/** Wire global invalidation: logout, role change, ERP refresh events. */
export function installErpCacheLifecycle(): void {
  if (lifecycleInstalled || typeof window === "undefined") return;
  lifecycleInstalled = true;

  window.addEventListener("auth:logout", () => clearErpDataCache("logout"));
  window.addEventListener("auth:login", () => {
    try {
      const raw = localStorage.getItem("user");
      const user = raw ? (JSON.parse(raw) as { role?: string }) : null;
      bindErpCacheRole(user?.role ?? null);
    } catch {
      bindErpCacheRole(null);
    }
  });

  window.addEventListener(ERP_REFRESH_EVENT, (ev) => {
    const detail = (ev as CustomEvent<ErpRefreshEventDetail>).detail;
    if (!detail?.scopes?.length) return;
    let role: string | undefined;
    try {
      const raw = localStorage.getItem("user");
      role = raw ? (JSON.parse(raw) as { role?: string }).role : undefined;
    } catch {
      role = undefined;
    }
    invalidateErpCacheForScopes(detail.scopes, role);
  });
}
