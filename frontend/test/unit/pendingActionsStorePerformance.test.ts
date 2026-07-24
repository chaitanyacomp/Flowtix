import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPendingActionsPageApiPath, PENDING_ACTIONS_PAGE_API_ALLOWLIST } from "../../src/lib/pendingActionsPagePolicy";

const pagePath = resolve(__dirname, "../../src/pages/PendingActionsPage.tsx");
const hookPath = resolve(__dirname, "../../src/hooks/usePendingActionsPageData.ts");
const dashboardPath = resolve(__dirname, "../../src/pages/DashboardPage.tsx");
const storeDashPath = resolve(__dirname, "../../src/pages/store/StoreDispatchDashboard.tsx");
const servicePath = resolve(__dirname, "../../../backend/src/services/pendingActionsService.js");
const towerPath = resolve(__dirname, "../../../backend/src/services/controlTowerNormalizedRowsService.js");
const pageSource = readFileSync(pagePath, "utf8");
const hookSource = readFileSync(hookPath, "utf8");
const dashboardSource = readFileSync(dashboardPath, "utf8");
const storeDashSource = readFileSync(storeDashPath, "utf8");
const serviceSource = readFileSync(servicePath, "utf8");
const towerSource = readFileSync(towerPath, "utf8");

describe("PendingActionsPage store loading UX", () => {
  it("renders page shell with bucket skeleton instead of full-page gate", () => {
    const skeletonPath = resolve(__dirname, "../../src/components/erp/pending/PendingActionBucketSkeleton.tsx");
    const skeletonSource = readFileSync(skeletonPath, "utf8");
    expect(pageSource).toContain("PendingActionBucketSkeleton");
    expect(pageSource).not.toContain("ErpPageContentGate");
    expect(skeletonSource).toContain('data-testid="pending-action-bucket-skeleton"');
    expect(pageSource).toContain("ErpRefreshingBadge");
  });

  it("uses isolated pending-actions data hook without dashboard refresh scope", () => {
    expect(pageSource).toContain("usePendingActionsPageData");
    expect(pageSource).not.toContain('useErpRefreshTick(["dashboard"');
    expect(hookSource).toContain('useErpRefreshTick(["pending-actions"]');
    expect(hookSource).toContain("useRouteActive(PENDING_ACTIONS_ROUTE)");
    expect(hookSource).toContain('const PENDING_ACTIONS_ROUTE = "/pending-actions"');
    expect(hookSource).not.toContain('"dashboard"');
  });

  it("allows only pending-actions API on the page policy", () => {
    expect(PENDING_ACTIONS_PAGE_API_ALLOWLIST).toEqual(["/api/pending-actions"]);
    expect(isPendingActionsPageApiPath("/api/pending-actions")).toBe(true);
    expect(isPendingActionsPageApiPath("/api/pending-actions?role=STORE")).toBe(true);
    expect(isPendingActionsPageApiPath("/api/dashboard/continue-working")).toBe(false);
    expect(isPendingActionsPageApiPath("/api/planning-dashboard/no-qty-inbox")).toBe(false);
    expect(isPendingActionsPageApiPath("/api/procurement-planning/workspace")).toBe(false);
  });
});

describe("Dashboard widgets do not fetch when route inactive", () => {
  it("gates DashboardPage refresh tick and widget effects on /dashboard", () => {
    expect(dashboardSource).toContain('useRouteActive("/dashboard")');
    expect(dashboardSource).toContain("enabled: isDashboardRoute");
    expect(dashboardSource).toContain("if (!isDashboardRoute) return");
  });

  it("gates StoreDispatchDashboard operational fetches on /dashboard", () => {
    expect(storeDashSource).toContain('useRouteActive("/dashboard")');
    expect(storeDashSource).toContain("enabled: isDashboardRoute");
  });
});

describe("pendingActionsService store performance path", () => {
  it("uses store-scoped normalized merge and parallel store buckets", () => {
    expect(serviceSource).toContain("getStorePendingActions");
    expect(serviceSource).toContain("fetchStoreScopedNormalizedRows");
    expect(serviceSource).toContain('if (role === "STORE")');
    expect(serviceSource).toContain("Promise.all([");
    expect(towerSource).toContain("fetchStoreScopedNormalizedRows");
    expect(towerSource).toContain('scopedForRole: "STORE"');
  });

  it("scopes monthly plan query by role", () => {
    expect(serviceSource).toContain('fetchMonthlyPlanPendingActions(db, { role })');
    expect(serviceSource).toContain('role === "STORE"');
    expect(serviceSource).toContain('status: "AWAITING_PURCHASE_REVIEW"');
  });
});
