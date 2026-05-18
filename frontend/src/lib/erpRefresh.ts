/**
 * System-wide ERP data refresh signals (no React Query).
 * Mutations bump scoped tokens; dashboards/reports subscribe via useErpRefreshTick.
 */

export type ErpRefreshScope =
  | "all"
  | "dashboard"
  | "reports"
  | "qc"
  | "production"
  | "dispatch"
  | "stock"
  | "sales"
  | "requirement"
  | "workorders"
  | "customer-tracking";

export const ERP_REFRESH_EVENT = "erp:data-changed";

/** Safe polling for summary screens (tab visible only). */
export const ERP_DASHBOARD_POLL_MS = 45_000;
export const ERP_REPORT_POLL_MS = 60_000;

export type ErpRefreshEventDetail = {
  scopes: ErpRefreshScope[];
  at: number;
};

const scopeTokens = new Map<ErpRefreshScope, number>();

function nextToken(scope: ErpRefreshScope): number {
  const n = (scopeTokens.get(scope) ?? 0) + 1;
  scopeTokens.set(scope, n);
  return n;
}

/** Notify listeners that backend-backed data may have changed. */
export function bumpErpRefresh(scopes: ErpRefreshScope | ErpRefreshScope[]): void {
  const list = Array.isArray(scopes) ? scopes : [scopes];
  const uniq = new Set<ErpRefreshScope>(list);
  uniq.add("all");

  for (const s of uniq) {
    nextToken(s);
  }

  if (typeof window === "undefined") return;

  try {
    window.dispatchEvent(
      new CustomEvent<ErpRefreshEventDetail>(ERP_REFRESH_EVENT, {
        detail: { scopes: [...uniq], at: Date.now() },
      }),
    );
  } catch {
    // ignore
  }
}

/** True when any subscribed scope (or `all`) was bumped in this event. */
export function erpRefreshEventMatches(
  detail: ErpRefreshEventDetail | undefined,
  subscribed: ErpRefreshScope[],
): boolean {
  if (!detail?.scopes?.length) return false;
  const changed = new Set(detail.scopes);
  if (changed.has("all")) return true;
  return subscribed.some((s) => changed.has(s));
}

/**
 * Map successful mutation paths to refresh scopes (read-only GETs do not bump).
 */
export function erpRefreshScopesForMutation(path: string, method: string): ErpRefreshScope[] {
  const m = String(method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return [];

  const p = String(path || "")
    .toLowerCase()
    .split("?")[0];

  const scopes = new Set<ErpRefreshScope>(["reports", "dashboard"]);

  if (
    p.includes("/production") ||
    p.includes("/work-orders") ||
    p.includes("/wo-planning") ||
    p.includes("/rm-check")
  ) {
    scopes.add("production");
    scopes.add("workorders");
  }
  if (p.includes("qc") || p.includes("scrap")) {
    scopes.add("qc");
  }
  if (p.includes("/dispatch")) {
    scopes.add("dispatch");
    scopes.add("customer-tracking");
  }
  if (
    p.includes("/stock") ||
    p.includes("/opening-stock") ||
    p.includes("/items") ||
    p.includes("/boms") ||
    p.includes("/grn") ||
    p.includes("/purchase")
  ) {
    scopes.add("stock");
  }
  if (
    p.includes("/sales-orders") ||
    p.includes("/sales-bills") ||
    p.includes("/enquir") ||
    p.includes("/quotation") ||
    p.includes("/rate-contract")
  ) {
    scopes.add("sales");
    scopes.add("customer-tracking");
  }
  if (p.includes("/requirement-sheet") || p.includes("/planning-dashboard")) {
    scopes.add("requirement");
  }
  if (p.includes("/customer-return") || p.includes("/customer-po") || p.includes("/tracking")) {
    scopes.add("customer-tracking");
  }
  if (p.includes("/database-cleanup") || p.includes("/backup") || p.includes("/admin")) {
    scopes.add("all");
  }

  return [...scopes];
}
