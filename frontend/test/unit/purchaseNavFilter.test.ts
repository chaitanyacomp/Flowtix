import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPurchaseNavItemVisible } from "../../src/lib/purchaseNavFilter";
import { hasErpRole, MATERIAL_REQUISITION_WRITE_ROLES, RM_STOCK_PLANNING_ROLES } from "../../src/config/erpRoles";
import { PURCHASE_WIDGET_UNAVAILABLE } from "../../src/lib/purchaseDashboardWidgets";

const appLayoutPath = resolve(__dirname, "../../src/components/AppLayout.tsx");
const appPath = resolve(__dirname, "../../src/App.tsx");
const dashboardPath = resolve(__dirname, "../../src/pages/DashboardPage.tsx");
const appLayoutSource = readFileSync(appLayoutPath, "utf8");
const appSource = readFileSync(appPath, "utf8");
const dashboardSource = readFileSync(dashboardPath, "utf8");

describe("purchaseNavFilter", () => {
  it("hides store-owned planning workspaces from PURCHASE sidebar", () => {
    expect(isPurchaseNavItemVisible("PURCHASE", "mat-plan")).toBe(false);
    expect(isPurchaseNavItemVisible("PURCHASE", "rm-stock-plan")).toBe(false);
    expect(isPurchaseNavItemVisible("PURCHASE", "proc-plan")).toBe(true);
    expect(isPurchaseNavItemVisible("STORE", "mat-plan")).toBe(true);
  });
});

describe("Purchase route alignment with backend permissions", () => {
  it("uses store-owned roles for Order RM Planning and RM Stock Planning routes", () => {
    expect(hasErpRole("PURCHASE", MATERIAL_REQUISITION_WRITE_ROLES)).toBe(false);
    expect(hasErpRole("PURCHASE", RM_STOCK_PLANNING_ROLES)).toBe(false);
    expect(hasErpRole("STORE", MATERIAL_REQUISITION_WRITE_ROLES)).toBe(true);
    expect(hasErpRole("STORE", RM_STOCK_PLANNING_ROLES)).toBe(true);
    expect(appSource).toContain("MATERIAL_REQUISITION_WRITE_ROLES");
    expect(appSource).toContain("RM_STOCK_PLANNING_ROLES");
    expect(appLayoutSource).toContain("roles: [...MATERIAL_REQUISITION_WRITE_ROLES]");
    expect(appLayoutSource).toContain("roles: [...RM_STOCK_PLANNING_ROLES]");
  });

  it("renders dedicated purchase desk before generic dashboard loading gate", () => {
    expect(dashboardSource).toContain("!usesDedicatedRoleDesk");
    expect(dashboardSource).toMatch(/if \(role === "PURCHASE"\)[\s\S]*PurchaseDashboardPage/);
    const purchaseIdx = dashboardSource.indexOf('if (role === "PURCHASE")');
    const loadingIdx = dashboardSource.indexOf("if (loading)");
    expect(purchaseIdx).toBeGreaterThan(-1);
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(purchaseIdx).toBeLessThan(loadingIdx);
  });
});

describe("purchaseDashboardWidgets", () => {
  it("uses a stable forbidden message for role-blocked widgets", () => {
    expect(PURCHASE_WIDGET_UNAVAILABLE).toBe("Not available for this role.");
  });
});
