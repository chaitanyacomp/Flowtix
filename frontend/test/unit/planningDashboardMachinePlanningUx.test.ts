import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { regularSoMachinePlanningRmLabel } from "../../src/lib/regularSoMachinePlanningRmLabel";
import { CARRY_FORWARD_PENDING_ROLES, hasErpRole } from "../../src/config/erpRoles";

const planningPagePath = resolve(__dirname, "../../src/pages/PlanningDashboardPage.tsx");
const carryForwardSectionPath = resolve(
  __dirname,
  "../../src/components/erp/planning/CarryForwardPendingSection.tsx",
);
const planningPageSource = readFileSync(planningPagePath, "utf8");
const carryForwardSectionSource = readFileSync(carryForwardSectionPath, "utf8");

describe("regularSoMachinePlanningRmLabel", () => {
  it("pending planning + sufficient RM displays RM Available, not Ready for WO", () => {
    const label = regularSoMachinePlanningRmLabel({
      machinePlanningComplete: false,
      storeOperationalKey: null,
      rmReadinessSummary: {
        canCreateWorkOrder: true, // must be ignored until planning is complete
        shortageRmCount: 0,
        shortageQtyTotal: 0,
        requiredQtyTotal: 5,
        availableQtyTotal: 20,
        storeOperationalKey: "RM_AVAILABLE",
      },
    });
    expect(label).toBe("RM Available");
    expect(label).not.toContain("Ready for WO");
  });

  it("pending planning + short RM displays RM Shortage", () => {
    const label = regularSoMachinePlanningRmLabel({
      machinePlanningComplete: false,
      rmReadinessSummary: {
        canCreateWorkOrder: false,
        shortageRmCount: 1,
        shortageQtyTotal: 12,
        requiredQtyTotal: 20,
        availableQtyTotal: 8,
      },
    });
    expect(label).toMatch(/^RM Shortage/);
    expect(label).not.toContain("Ready for WO");
  });

  it("Ready for WO requires completed planning", () => {
    expect(
      regularSoMachinePlanningRmLabel({
        machinePlanningComplete: false,
        storeOperationalKey: "READY_FOR_WO",
        rmReadinessSummary: { canCreateWorkOrder: true },
      }),
    ).toBe("RM Available");

    expect(
      regularSoMachinePlanningRmLabel({
        machinePlanningComplete: true,
        storeOperationalKey: "READY_FOR_WO",
        rmReadinessSummary: { canCreateWorkOrder: true, shortageQtyTotal: 0 },
      }),
    ).toBe("Ready for WO");
  });
});

describe("Planning Dashboard Carry Forward Pending role gate", () => {
  it("Production does not render or request Carry Forward Pending", () => {
    expect(hasErpRole("PRODUCTION", CARRY_FORWARD_PENDING_ROLES)).toBe(false);
    expect(planningPageSource).toContain("canSeeCarryForwardPending");
    expect(planningPageSource).toContain("CARRY_FORWARD_PENDING_ROLES");
    expect(planningPageSource).toMatch(/canSeeCarryForwardPending\s*\?\s*\(/);
    expect(carryForwardSectionSource).toContain("if (!allowed) return null");
    expect(carryForwardSectionSource).toContain("if (!allowed)");
    expect(carryForwardSectionSource).toContain("fetchCarryForwardPending");
  });

  it("Admin/Store retain their authorized section", () => {
    expect(hasErpRole("ADMIN", CARRY_FORWARD_PENDING_ROLES)).toBe(true);
    expect(hasErpRole("STORE", CARRY_FORWARD_PENDING_ROLES)).toBe(true);
    expect(planningPageSource).toContain('data-testid="carry-forward-pending-section"');
    expect(planningPageSource).toContain("<CarryForwardPendingSection enabled />");
  });

  it("does not call commercial sales-order list for non-ADMIN roles", () => {
    expect(planningPageSource).toContain("canReadCommercialSalesOrderList");
    expect(planningPageSource).toContain("SO_READ_ROLES");
  });
});
