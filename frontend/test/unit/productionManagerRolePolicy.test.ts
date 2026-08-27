/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { canWriteProductionMasters, isProductionManagerReadOnlyMasters } from "../../src/lib/productionMasterPermissions";
import {
  filterPendingActionsUnrelatedToActiveRuns,
  filterProdQueueExcludingActiveRunWos,
  shouldHideProductionDashboardDuplicates,
} from "../../src/lib/productionDashboardActiveRunUi";
import {
  isProductionManagerNavItemVisible,
  listVisibleProductionManagerNavKeys,
} from "../../src/lib/productionManagerNavFilter";
import { isProductionNavItemVisible } from "../../src/lib/productionNavFilter";
import {
  PLANNING_DASHBOARD_ROLES,
  PRODUCTION_MASTER_READ_ROLES,
  PRODUCTION_MASTER_WRITE_ROLES,
  hasErpRole,
} from "../../src/config/erpRoles";
import { dashboardWorkspaceHeadline } from "../../src/lib/dashboardShell";

describe("Production Manager / Production role policy", () => {
  it("PRODUCTION_MANAGER gets Requirement & Cycle Planning; PRODUCTION nav hides it", () => {
    expect(hasErpRole("PRODUCTION_MANAGER", PLANNING_DASHBOARD_ROLES)).toBe(true);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "plan-dash")).toBe(true);
    expect(isProductionNavItemVisible("PRODUCTION", "plan-dash")).toBe(false);
  });

  it("PRODUCTION_MANAGER nav excludes Masters Hub and includes read-only masters + FG Standards", () => {
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "masters-hub")).toBe(false);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "machines")).toBe(true);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "operators")).toBe(true);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "shifts")).toBe(true);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "fg-standards")).toBe(true);
    expect(isProductionManagerNavItemVisible("PRODUCTION_MANAGER", "shift-prod")).toBe(true);

    const keys = listVisibleProductionManagerNavKeys("PRODUCTION_MANAGER", [
      { navKey: "masters-hub", roles: ["PRODUCTION_MANAGER"] },
      { navKey: "plan-dash", roles: [...PLANNING_DASHBOARD_ROLES] },
      { navKey: "machines", roles: [...PRODUCTION_MASTER_READ_ROLES] },
      { navKey: "operators", roles: [...PRODUCTION_MASTER_READ_ROLES] },
      { navKey: "shifts", roles: [...PRODUCTION_MASTER_READ_ROLES] },
      { navKey: "fg-standards", roles: [...PRODUCTION_MASTER_READ_ROLES] },
      { navKey: "shift-prod", roles: ["PRODUCTION_MANAGER"] },
    ]);
    expect(keys).toEqual(["plan-dash", "machines", "operators", "shifts", "fg-standards", "shift-prod"]);
  });

  it("Production Manager cannot write production masters", () => {
    expect(canWriteProductionMasters("PRODUCTION_MANAGER")).toBe(false);
    expect(isProductionManagerReadOnlyMasters("PRODUCTION_MANAGER")).toBe(true);
    expect(PRODUCTION_MASTER_WRITE_ROLES).not.toContain("PRODUCTION_MANAGER");
    expect(canWriteProductionMasters("ADMIN")).toBe(true);
    expect(canWriteProductionMasters("PRODUCTION")).toBe(true);
  });

  it("active shift run hides dashboard duplicates and filters same-WO pending actions", () => {
    expect(shouldHideProductionDashboardDuplicates(1)).toBe(true);
    expect(shouldHideProductionDashboardDuplicates(0)).toBe(false);

    const actions = filterPendingActionsUnrelatedToActiveRuns(
      [
        { id: "production:wo:1001:line:1", href: "/production?workOrderId=1001", action: "Record Production" },
        { id: "qc:wo:99", href: "/qc-entry?workOrderId=99", action: "QC Pending" },
      ],
      [1001],
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("qc:wo:99");

    const queue = filterProdQueueExcludingActiveRunWos(
      [
        { workOrderId: 1001, itemName: "A" },
        { workOrderId: 2002, itemName: "B" },
      ],
      [1001],
    );
    expect(queue).toEqual([{ workOrderId: 2002, itemName: "B" }]);
  });

  it("Production dashboard omits shop-floor subtitle", () => {
    const h = dashboardWorkspaceHeadline("PRODUCTION");
    expect(h.title).toBe("Production Dashboard");
    expect(h.subtitle).toBe("");
    expect(h.subtitle.toLowerCase()).not.toContain("shop floor");
  });
});
