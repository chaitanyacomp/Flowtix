import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isProductionNavItemVisible,
  isRequirementCyclePlanningNavActive,
  isWorkOrderRegisterNavActive,
  listVisibleProductionFlowNavKeys,
  REQUIREMENT_CYCLE_PLANNING_HREF,
} from "../../src/lib/productionNavFilter";
import { hasErpRole, PLANNING_DASHBOARD_ROLES, WO_MACHINE_RUN_WRITE_ROLES } from "../../src/config/erpRoles";

const appLayoutPath = resolve(__dirname, "../../src/components/AppLayout.tsx");
const appLayoutSource = readFileSync(appLayoutPath, "utf8");

/** Mirrors Production Flow items in AppLayout (roles + keys only). */
const PRODUCTION_FLOW_ITEMS = [
  { navKey: "plan-dash", roles: [...PLANNING_DASHBOARD_ROLES] },
  { navKey: "no-qty-agreements", roles: [...PLANNING_DASHBOARD_ROLES] },
  { navKey: "wo", roles: ["ADMIN", "STORE", "PRODUCTION"] },
  { navKey: "prod", roles: ["ADMIN", "PRODUCTION"] },
  { navKey: "shift-prod", roles: ["ADMIN", "PRODUCTION_MANAGER", "PRODUCTION"] },
];

describe("productionNavFilter — Requirement & Cycle Planning", () => {
  it("PRODUCTION nav hides Requirement & Cycle Planning (Production Manager–owned)", () => {
    expect(isProductionNavItemVisible("PRODUCTION", "plan-dash")).toBe(false);
    expect(listVisibleProductionFlowNavKeys("PRODUCTION", PRODUCTION_FLOW_ITEMS)).not.toContain("plan-dash");
    expect(listVisibleProductionFlowNavKeys("PRODUCTION", PRODUCTION_FLOW_ITEMS)).toEqual(
      expect.arrayContaining(["wo", "prod", "shift-prod"]),
    );
    expect(listVisibleProductionFlowNavKeys("PRODUCTION", PRODUCTION_FLOW_ITEMS)).not.toContain("no-qty-agreements");
  });

  it("ADMIN and PRODUCTION_MANAGER see Requirement & Cycle Planning", () => {
    expect(isProductionNavItemVisible("ADMIN", "plan-dash")).toBe(true);
    expect(listVisibleProductionFlowNavKeys("ADMIN", PRODUCTION_FLOW_ITEMS)).toContain("plan-dash");
    expect(hasErpRole("ADMIN", PLANNING_DASHBOARD_ROLES)).toBe(true);
    expect(hasErpRole("PRODUCTION_MANAGER", PLANNING_DASHBOARD_ROLES)).toBe(true);
  });

  it("STORE does not receive machine-planning edit access", () => {
    expect(hasErpRole("STORE", WO_MACHINE_RUN_WRITE_ROLES)).toBe(false);
    expect(hasErpRole("PRODUCTION", WO_MACHINE_RUN_WRITE_ROLES)).toBe(true);
    expect(hasErpRole("ADMIN", WO_MACHINE_RUN_WRITE_ROLES)).toBe(true);
    // STORE may still open the planning hub (NO_QTY / read) but cannot write machine runs.
    expect(hasErpRole("STORE", PLANNING_DASHBOARD_ROLES)).toBe(true);
  });

  it("menu link and Pending Action open the same planning route hub", () => {
    expect(REQUIREMENT_CYCLE_PLANNING_HREF).toBe("/planning-dashboard");
    expect(appLayoutSource).toContain("REQUIREMENT_CYCLE_PLANNING_HREF");
    expect(appLayoutSource).toContain('navKey: "plan-dash"');
    expect(appLayoutSource).toContain("Requirement & Cycle Planning");
    expect(appLayoutSource).toContain("isRequirementCyclePlanningNavActive");
  });

  it("active menu highlighting covers planning queue and machine-run workspace", () => {
    expect(isRequirementCyclePlanningNavActive("/planning-dashboard")).toBe(true);
    expect(isRequirementCyclePlanningNavActive("/planning-dashboard?focus=machine-planning")).toBe(true);
    expect(isRequirementCyclePlanningNavActive("/work-orders/prepare")).toBe(true);
    expect(
      isRequirementCyclePlanningNavActive("/work-orders/prepare?salesOrderId=1&intent=machine-planning"),
    ).toBe(true);
    expect(isRequirementCyclePlanningNavActive("/rm-check")).toBe(true);
    expect(isRequirementCyclePlanningNavActive("/work-orders")).toBe(false);
    expect(isRequirementCyclePlanningNavActive("/production")).toBe(false);

    expect(isWorkOrderRegisterNavActive("/work-orders")).toBe(true);
    expect(isWorkOrderRegisterNavActive("/work-orders?flow=REGULAR_SO")).toBe(true);
    expect(isWorkOrderRegisterNavActive("/work-orders/123")).toBe(true);
    expect(isWorkOrderRegisterNavActive("/work-orders/prepare")).toBe(false);
    expect(isWorkOrderRegisterNavActive("/rm-check")).toBe(false);
  });

  it("does not expose commercial Sales Order nav to PRODUCTION", () => {
    expect(isProductionNavItemVisible("PRODUCTION", "so")).toBe(false);
    expect(isProductionNavItemVisible("PRODUCTION", "quot")).toBe(false);
    expect(isProductionNavItemVisible("PRODUCTION", "salebill")).toBe(false);
  });

  it("AppLayout wires custom active state for plan-dash and wo under Production Flow", () => {
    expect(appLayoutSource).toContain('item.navKey === "plan-dash"');
    expect(appLayoutSource).toContain('item.navKey === "wo"');
    expect(appLayoutSource).toContain("isWorkOrderRegisterNavActive");
    expect(appLayoutSource).toContain("sidebarCollapsed");
  });
});
