/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isReturnPathAllowedForRole,
  resolvePostLoginDestination,
  resolveRoleLandingPath,
  ROLE_LANDING_PATH,
} from "../../src/lib/authReturnPath";
import {
  isProductionManagerNavItemVisible,
  listVisibleProductionManagerNavKeys,
} from "../../src/lib/productionManagerNavFilter";
import { DASHBOARD_SHELL_ROLES, PRODUCTION_MASTER_READ_ROLES } from "../../src/config/erpRoles";

const appLayoutPath = resolve(__dirname, "../../src/components/AppLayout.tsx");
const appPath = resolve(__dirname, "../../src/App.tsx");
const appLayoutSource = readFileSync(appLayoutPath, "utf8");
const appSource = readFileSync(appPath, "utf8");

/** Mirrors key nav items used by PRODUCTION_MANAGER (roles + keys only). */
const PM_NAV_ITEMS = [
  { navKey: "dash-home", roles: ["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "PRODUCTION_MANAGER", "QA"] },
  { navKey: "control-tower", roles: ["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "PRODUCTION_MANAGER", "QA"] },
  { navKey: "masters-hub", roles: ["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "PRODUCTION_MANAGER", "QA"] },
  { navKey: "machines", roles: [...PRODUCTION_MASTER_READ_ROLES] },
  { navKey: "operators", roles: [...PRODUCTION_MASTER_READ_ROLES] },
  { navKey: "shifts", roles: [...PRODUCTION_MASTER_READ_ROLES] },
  { navKey: "shift-prod", roles: ["ADMIN", "PRODUCTION_MANAGER", "PRODUCTION"] },
  { navKey: "prod", roles: ["ADMIN", "PRODUCTION"] },
  { navKey: "reports", roles: ["ADMIN"] },
];

describe("PRODUCTION_MANAGER landing", () => {
  it("resolveRoleLandingPath overrides API /dashboard to /shift-production", () => {
    expect(resolveRoleLandingPath("PRODUCTION_MANAGER", "/dashboard")).toBe("/shift-production");
    expect(resolveRoleLandingPath("PRODUCTION_MANAGER", null)).toBe("/shift-production");
    expect(resolveRoleLandingPath("PRODUCTION", "/dashboard")).toBe("/dashboard");
    expect(resolveRoleLandingPath("ADMIN", null)).toBe(ROLE_LANDING_PATH);
  });

  it("resolvePostLoginDestination sends PRODUCTION_MANAGER to Shift Production by default", () => {
    expect(
      resolvePostLoginDestination(null, {
        role: "PRODUCTION_MANAGER",
        landingPath: "/dashboard",
      }),
    ).toBe("/shift-production");
    expect(
      resolvePostLoginDestination("/dashboard", {
        role: "PRODUCTION_MANAGER",
        landingPath: "/dashboard",
      }),
    ).toBe("/shift-production");
    expect(
      resolvePostLoginDestination("/shift-production", {
        role: "PRODUCTION_MANAGER",
        landingPath: "/dashboard",
      }),
    ).toBe("/shift-production");
  });

  it("blocks dashboard and control-tower as post-login return paths for PRODUCTION_MANAGER", () => {
    expect(isReturnPathAllowedForRole("/dashboard", "PRODUCTION_MANAGER")).toBe(false);
    expect(isReturnPathAllowedForRole("/control-tower", "PRODUCTION_MANAGER")).toBe(false);
    expect(isReturnPathAllowedForRole("/pending-actions", "PRODUCTION_MANAGER")).toBe(false);
    expect(isReturnPathAllowedForRole("/shift-production", "PRODUCTION_MANAGER")).toBe(true);
  });

  it("App root and catch-all use resolveRoleLandingPath", () => {
    expect(appSource).toContain("resolveRoleLandingPath");
    expect(appSource).not.toMatch(/auth\.isAuthed \? ROLE_LANDING_PATH/);
  });

  it("dashboard shell routes exclude PRODUCTION_MANAGER", () => {
    expect(DASHBOARD_SHELL_ROLES).not.toContain("PRODUCTION_MANAGER");
    expect(appSource).toContain("DASHBOARD_SHELL_ROLES");
    expect(appSource).toContain('path="/dashboard"');
    expect(appSource).toContain('path="/control-tower"');
  });
});

describe("PRODUCTION_MANAGER navigation filter", () => {
  it("shows Shift Production and authorized masters read links only", () => {
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "shift-prod")).toBe(true);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "masters-hub")).toBe(true);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "machines")).toBe(true);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "operators")).toBe(true);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "shifts")).toBe(true);

    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "dash-home")).toBe(false);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "control-tower")).toBe(false);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "prod")).toBe(false);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "reports")).toBe(false);

    expect(listVisibleProductionManagerNavKeys("PRODUCTION_MANAGER", PM_NAV_ITEMS)).toEqual([
      "masters-hub",
      "machines",
      "operators",
      "shifts",
      "shift-prod",
    ]);
  });

  it("does not affect other roles", () => {
    expect(isProductionManagerNavItemVisible("PRODUCTION", "dash-home")).toBe(true);
    expect(isProductionManagerNavItemVisible("ADMIN", "control-tower")).toBe(true);
    expect(listVisibleProductionManagerNavKeys("PRODUCTION", PM_NAV_ITEMS)).toEqual([]);
  });

  it("AppLayout wires productionManagerNavFilter and role home path", () => {
    expect(appLayoutSource).toContain("isProductionManagerNavItemVisible");
    expect(appLayoutSource).toContain("resolveRoleLandingPath");
    expect(appLayoutSource).toContain("PRODUCTION_MASTER_READ_ROLES");
  });
});
