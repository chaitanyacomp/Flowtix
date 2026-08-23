import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  derivePlannedSetupCountFromRuns,
  estimateRunDurationLabel,
  mapApiRunsToDraft,
  sumAllocatedQtyForFg,
} from "../../src/lib/woProductionRunAllocation";
import { computeTotalPlannedPurgingGrams } from "../../src/lib/woPlanningPurging";
import { WO_MACHINE_RUN_WRITE_ROLES, REGULAR_SO_WO_CREATE_ROLES, hasErpRole } from "../../src/config/erpRoles";
import {
  woPreparePrimaryCta,
  woMachinePlanningHref,
} from "../../src/lib/woPrepareOperationalStage";

describe("woProductionRunAllocation helpers", () => {
  it("counts production run rows (not physical setups / not purges)", () => {
    expect(derivePlannedSetupCountFromRuns([{ clientKey: "a", fgItemId: 1, runSequence: 1, machineId: 10, plannedQty: 100 }])).toBe(1);
    expect(
      derivePlannedSetupCountFromRuns([
        { clientKey: "a", fgItemId: 1, runSequence: 1, machineId: 10, plannedQty: 50 },
        { clientKey: "b", fgItemId: 1, runSequence: 2, machineId: 11, plannedQty: 50 },
      ]),
    ).toBe(2);
  });

  it("sums allocated qty per FG for reconciliation", () => {
    expect(
      sumAllocatedQtyForFg(
        [
          { clientKey: "a", fgItemId: 1, runSequence: 1, machineId: 10, plannedQty: 40 },
          { clientKey: "b", fgItemId: 1, runSequence: 2, machineId: 10, plannedQty: 60 },
        ],
        1,
      ),
    ).toBe(100);
  });

  it("estimates duration from FG-machine standard fields", () => {
    expect(
      estimateRunDurationLabel({
        plannedQty: 950,
        cycleTimeSeconds: 10,
        piecesPerCycle: 1,
        standardEfficiencyPercent: 95,
      }),
    ).toBeTruthy();
  });

  it("purging total = standard × planned purge count", () => {
    expect(computeTotalPlannedPurgingGrams(200, 2)).toBe(400);
    expect(computeTotalPlannedPurgingGrams(200, 0)).toBe(0);
  });

  it("mapApiRunsToDraft tolerates incomplete detection payloads", () => {
    const drafts = mapApiRunsToDraft([
      { fgItemId: 1, machineId: 2, plannedQty: 10, runSequence: 1 } as any,
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].purgingDetectionStatus).toBeNull();
  });
});

describe("STORE WO preparation safety", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/RmCheckPage.tsx"), "utf8");
  const panel = readFileSync(
    resolve(__dirname, "../../src/components/erp/WoPrepareProductionRunAllocationPanel.tsx"),
    "utf8",
  );

  it("STORE cannot write machine runs (role gate)", () => {
    expect(hasErpRole("STORE", WO_MACHINE_RUN_WRITE_ROLES)).toBe(false);
    expect(hasErpRole("ADMIN", WO_MACHINE_RUN_WRITE_ROLES)).toBe(true);
    expect(hasErpRole("PRODUCTION", WO_MACHINE_RUN_WRITE_ROLES)).toBe(true);
  });

  it("RmCheckPage wraps content in an error fallback (no blank crash screen)", () => {
    expect(source).toContain("WoPreparePageErrorBoundary");
    expect(source).toContain('data-testid="wo-prepare-page-error-fallback"');
    expect(source).not.toContain("setPlannedSetupCountInput");
  });

  it("STORE with no allocation sees pending-action message wiring", () => {
    expect(source).toContain("Machine allocation pending — Production action required.");
    expect(source).toContain("pendingActionMessage");
    expect(panel).toContain('data-testid="wo-machine-allocation-pending"');
    expect(panel).toContain('data-testid="wo-run-allocation-readonly"');
  });

  it("STORE read-only path does not call onChange writers", () => {
    expect(source).toContain("if (!canEditMachineRuns) return;");
    expect(source).toContain("readOnly={!canEditMachineRuns}");
    expect(panel).toContain("if (readOnly || disabled) return;");
  });

  it("ADMIN/PRODUCTION edit controls remain available", () => {
    expect(panel).toContain('data-testid="wo-add-production-run"');
    expect(panel).toContain("{!readOnly ? (");
    expect(source).toContain("WO_MACHINE_RUN_WRITE_ROLES");
    expect(source).toContain("Save Planning Draft");
    expect(source).toContain("Complete Machine Planning");
  });

  it("STORE can create WO; PRODUCTION cannot (REGULAR)", () => {
    expect(hasErpRole("STORE", REGULAR_SO_WO_CREATE_ROLES)).toBe(true);
    expect(hasErpRole("ADMIN", REGULAR_SO_WO_CREATE_ROLES)).toBe(true);
    expect(hasErpRole("PRODUCTION", REGULAR_SO_WO_CREATE_ROLES)).toBe(false);
    expect(source).toContain("REGULAR_SO_WO_CREATE_ROLES");
  });

  it("Admin primary stage action prefers Plan Machine Runs when pending", () => {
    const cta = woPreparePrimaryCta(42, {
      key: "MACHINE_PLANNING_PENDING",
      label: "Machine Planning Pending",
      nextActionKey: "PLAN_MACHINE_RUNS",
    }, "ADMIN");
    expect(cta.label).toBe("Plan Machine Runs");
    expect(cta.to).toBe(woMachinePlanningHref(42));
  });

  it("STORE Create Work Order only when READY_FOR_WO", () => {
    const ready = woPreparePrimaryCta(7, {
      key: "READY_FOR_WO",
      label: "Ready for WO",
      nextActionKey: "CREATE_WO",
    }, "STORE");
    expect(ready.label).toBe("Create Work Order");
    const pending = woPreparePrimaryCta(7, {
      key: "MACHINE_PLANNING_PENDING",
      label: "Machine Planning Pending",
      nextActionKey: "PLAN_MACHINE_RUNS",
    }, "STORE");
    expect(pending.label).toBe("Plan Machine Runs");
  });

  it("planning hub includes Regular machine planning queue", () => {
    const dash = readFileSync(resolve(__dirname, "../../src/pages/PlanningDashboardPage.tsx"), "utf8");
    const queue = readFileSync(
      resolve(__dirname, "../../src/components/erp/RegularSoMachinePlanningQueueSection.tsx"),
      "utf8",
    );
    expect(dash).toContain("RegularSoMachinePlanningQueueSection");
    expect(queue).toContain("Plan Machine Runs");
    expect(queue).toContain("handedToStore");
    expect(queue).toContain("needsPlanning");
    expect(queue).toContain("Handed to Store");
    expect(queue).not.toMatch(/\bmargin\b|\bunit price\b|\bcustomer price\b/i);
  });

  it("Store shortage handoff reuses RM_SHORTAGE and shows required/available/shortage", () => {
    const queues = readFileSync(
      resolve(__dirname, "../../src/components/erp/WoPrepareOperationalQueuesCard.tsx"),
      "utf8",
    );
    expect(queues).toContain("rmRequiredQtyTotal");
    expect(queues).toContain("rmAvailableQtyTotal");
    expect(queues).toContain("rmShortageQtyTotal");
    expect(queues).toContain("RM shortage blocking WO");
  });

  it("uses productionRuns on WO create and hides manual setup edit", () => {
    expect(source).toContain("productionRuns: runsPayload");
    expect(source).toContain("WoPrepareProductionRunAllocationPanel");
    expect(source).not.toMatch(/plannedSetupCountInput/);
  });
});

describe("NO_QTY execution machine-run wiring", () => {
  const rsSource = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/RequirementSheetExecutionPanel.tsx"),
    "utf8",
  );

  it("passes productionRuns on create-wo and rm-preview", () => {
    expect(rsSource).toContain("productionRuns: runsToApiPayload(productionRuns)");
    expect(rsSource).toContain("WoPrepareProductionRunAllocationPanel");
    expect(rsSource).toContain("execution/production-runs");
  });

  it("NO_QTY lifecycle files remain isolated from Regular machine planning queue API", () => {
    expect(rsSource).not.toContain("regular-so-machine-planning-queue");
    expect(rsSource).not.toContain("machinePlanningMode");
  });
});

describe("purging panel is read-only for setup count", () => {
  const panel = readFileSync(
    resolve(__dirname, "../../src/components/erp/WoPreparePurgingPlanningPanel.tsx"),
    "utf8",
  );

  it("shows planned purge count separately from run count", () => {
    expect(panel).toContain("Planned purge count");
    expect(panel).toContain("Production run count");
    expect(panel).toContain("BOM standard × planned purge count");
    expect(panel).toContain("Not planned / legacy record");
  });
});
