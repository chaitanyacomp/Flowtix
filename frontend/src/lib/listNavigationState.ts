/**
 * List → Record → Back restoration policy for operational lists.
 *
 * Prefer URL search params (survives refresh, shareable, Back/Forward).
 * Optional session scroll restore is bounded and path-scoped — never restores
 * modal open state or action-triggering selections.
 *
 * @see docs/ERP_BROWSER_NAVIGATION_AND_RECOVERY_STANDARD.md §11
 */

import { isSafeInternalReturnPath } from "./authReturnPath";

export const LIST_SCROLL_SESSION_PREFIX = "erp:listScroll:v1:";

/** Query key carrying a sanitized list URL for explicit Back from record pages. */
export const LIST_RETURN_TO_QUERY_KEY = "returnTo";

/** Keys that must never be restored from transient storage (action / modal). */
export const LIST_STATE_FORBIDDEN_RESTORE_KEYS = [
  "action",
  "openInvoice",
  "draftDispatchId",
  "modal",
  "confirm",
  "finalize",
] as const;

const memoryStore = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage.getItem(key);
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
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  memoryStore.delete(key);
}

export function listScrollStorageKey(pathname: string): string {
  return `${LIST_SCROLL_SESSION_PREFIX}${pathname}`;
}

export function saveListScrollPosition(pathname: string, scrollY: number): void {
  if (!pathname.startsWith("/")) return;
  storageSet(listScrollStorageKey(pathname), String(Math.max(0, Math.round(scrollY))));
}

export function consumeListScrollPosition(pathname: string): number | null {
  if (!pathname.startsWith("/")) return null;
  const key = listScrollStorageKey(pathname);
  const raw = storageGet(key);
  storageRemove(key);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Strip forbidden action keys when restoring list query from a copied URL. */
export function sanitizeListSearchParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of LIST_STATE_FORBIDDEN_RESTORE_KEYS) {
    next.delete(k);
  }
  return next;
}

/**
 * Build a shareable list URL (path + sanitized search) for `returnTo` propagation.
 * Omits modal/action keys; keeps filters, search, tabs, pagination, sort.
 */
export function buildListReturnTo(pathname: string, search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = sanitizeListSearchParams(new URLSearchParams(raw));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Append list `returnTo` to a record/detail href when not already present.
 * `listReturnTo` must be a safe internal path (typically from `buildListReturnTo`).
 */
export function withListReturnContext(href: string, listReturnTo: string | null | undefined): string {
  if (!listReturnTo || !isSafeInternalReturnPath(listReturnTo)) return href;
  const qIndex = href.indexOf("?");
  const path = qIndex >= 0 ? href.slice(0, qIndex) : href;
  const params = new URLSearchParams(qIndex >= 0 ? href.slice(qIndex + 1) : "");
  if (params.has(LIST_RETURN_TO_QUERY_KEY)) return href;
  params.set(LIST_RETURN_TO_QUERY_KEY, listReturnTo);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Resolve explicit list back target from `returnTo` query; falls back when unsafe. */
export function resolveListBackTarget(returnToQuery: string | null | undefined, fallback: string): string {
  if (returnToQuery == null) return fallback;
  const raw = String(returnToQuery).trim();
  if (!raw) return fallback;
  try {
    const decoded = decodeURIComponent(raw);
    if (isSafeInternalReturnPath(decoded)) return decoded;
  } catch {
    /* ignore */
  }
  if (isSafeInternalReturnPath(raw)) return raw;
  return fallback;
}

/** Parse positive integer list page from URL; invalid values fall back to 1. */
export function readListPageParam(sp: URLSearchParams, key: string, defaultPage = 1): number {
  const n = Number(sp.get(key));
  if (!Number.isFinite(n) || n < 1) return defaultPage;
  return Math.floor(n);
}
