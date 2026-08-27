import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatCompactCapacitySummary,
  formatExceedsOneShiftBadge,
  estimateRunCapacityContext,
  MULTI_SHIFT_CAPACITY_HELP,
} from "../../src/lib/woRunCapacityEstimate";
import { getPageTitle } from "../../src/lib/routeTitles";
import { REGULAR_TERMS } from "../../src/lib/flowTerminology";
import { hasErpRole, WO_MACHINE_RUN_WRITE_ROLES } from "../../src/config/erpRoles";

const root = resolve(__dirname, "../..");
const rmCheckSource = readFileSync(resolve(root, "src/pages/RmCheckPage.tsx"), "utf8");
const compactSource = readFileSync(
  resolve(root, "src/components/erp/MachineRunPlanningCompact.tsx"),
  "utf8",
);
const allocationSource = readFileSync(
  resolve(root, "src/components/erp/WoPrepareProductionRunAllocationPanel.tsx"),
  "utf8",
);
const queueSource = readFileSync(
  resolve(root, "src/components/erp/RegularSoMachinePlanningQueueSection.tsx"),
  "utf8",
);
const snapshotSvc = readFileSync(
  resolve(root, "../backend/src/services/regularSoPlanningSnapshotService.js"),
  "utf8",
);
const salesOrdersRoutes = readFileSync(
  resolve(root, "../backend/src/routes/salesOrders.js"),
  "utf8",
);

describe("Machine Run Planning compact redesign", () => {
  it("uses Machine Run Planning title in page + app header route", () => {
    expect(REGULAR_TERMS.MACHINE_RUN_PLANNING_TITLE).toBe("Machine Run Planning");
    expect(getPageTitle("/work-orders/prepare", "?intent=machine-planning")).toBe(
      "Machine Run Planning",
    );
    expect(getPageTitle("/work-orders/prepare", "")).toBe("Prepare Work Order");
    // App header owns the title — body uses context strip, not a duplicate H1.
    expect(rmCheckSource).not.toContain('data-testid="machine-run-planning-page-title"');
    expect(rmCheckSource).toContain("MachineRunPlanningContextStrip");
  });

  it("compact workspace has single context / qty / RM / action surfaces (no duplicate totals cards)", () => {
    expect(rmCheckSource).toContain("machine-run-planning-compact-workspace");
    expect(rmCheckSource).toContain("MachineRunCombinedRmSummary");
    expect(rmCheckSource).toContain("MachineRunPlanningQtyStrip");
    expect(rmCheckSource).toContain("MachineRunPlanningActionBar");
    // Intent path must not mount separate purging panel + readiness table (combined instead).
    const intentBranch = rmCheckSource.slice(
      rmCheckSource.indexOf("machine-run-planning-compact-workspace"),
      rmCheckSource.indexOf("WoPrepareOperationalHeader"),
    );
    expect(intentBranch).not.toContain("WoPreparePurgingPlanningPanel");
    expect(intentBranch).not.toContain("WoPrepareRmReadinessTable");
    expect(intentBranch).not.toContain("WoPrepareProductionPlanningPanel");
    expect(intentBranch).not.toContain("WoPrepareGuidedStrip");
    expect(compactSource).toContain('data-testid="machine-planning-combined-rm"');
    expect(compactSource).toContain("Material Readiness");
    expect(compactSource.match(/Total planned RM/g) ?? []).toHaveLength(0);
  });

  it("completed planning is read-only and hides edit actions", () => {
    expect(rmCheckSource).toContain("canMutatePlanning");
    expect(rmCheckSource).toContain("machinePlanningStageBadge");
    expect(rmCheckSource).toContain("showEditActions={canMutatePlanning}");
    expect(rmCheckSource).toContain("readOnly={!canMutatePlanning}");
    expect(compactSource).toContain("Reopen Planning");
    expect(compactSource).toContain('data-testid="reopen-machine-planning"');
    expect(compactSource).toContain("Planning complete");
  });

  it("post-complete redirects to planning hub with success toast and double-submit guard", () => {
    expect(rmCheckSource).toContain(
      'toast.showSuccess("Machine planning completed and handed to Store.")',
    );
    expect(rmCheckSource).toContain('nav("/planning-dashboard")');
    expect(rmCheckSource).toContain("machinePlanningCompleteInFlightRef");
    expect(rmCheckSource).toContain("completingMachinePlanning");
  });

  it("queue offers View Plan for completed section", () => {
    expect(queueSource).toContain("Completed — Handed to Store");
    expect(queueSource).toContain("View Plan");
    expect(queueSource).toContain('intent: "machine-planning"');
  });

  it("compact capacity text and multi-shift badge", () => {
    const cap = estimateRunCapacityContext({
      plannedQty: 3600,
      cycleTimeSeconds: 10,
      piecesPerCycle: 1,
      standardEfficiencyPercent: 95,
      shift: { startTime: "08:00", endTime: "16:00", plannedBreakMinutes: 0 },
      plannedDate: "2026-08-23",
    });
    const summary = formatCompactCapacitySummary(cap);
    expect(summary).toMatch(/\d+h/);
    expect(summary).toMatch(/~\d+ shifts/);
    expect(formatExceedsOneShiftBadge(cap)).toMatch(/Exceeds one shift · continues across ~/);
    expect(allocationSource).toContain("formatCompactCapacitySummary");
    expect(allocationSource).toContain("formatExceedsOneShiftBadge");
    expect(allocationSource).toContain("MULTI_SHIFT_CAPACITY_HELP");
    expect(MULTI_SHIFT_CAPACITY_HELP).toMatch(/Shift changes do not add setup/);
  });

  it("1280 layout contract markers exist for dense packing", () => {
    expect(rmCheckSource).toContain('data-machine-planning-layout={useCompactMachinePlanning ? "compact"');
    // Fluid width for compact Machine Planning and Ready-for-WO confirmation layouts.
    expect(rmCheckSource).toContain(
      'data-page-width={useCompactMachinePlanning || useReadyForWoConfirmation ? "fluid" : "narrow"}',
    );
    expect(compactSource).toContain("erp-sticky-workflow-bar");
    expect(allocationSource).toContain("compactCapacity");
  });
});

describe("Reopen Planning API contract", () => {
  it("exposes audited reopen endpoint and blocks WO-created reopen", () => {
    expect(salesOrdersRoutes).toContain("/:id/machine-planning/reopen");
    expect(salesOrdersRoutes).toContain("WO_MACHINE_RUN_WRITE_ROLES");
    expect(snapshotSvc).toContain("reopenRegularSoMachinePlanning");
    expect(snapshotSvc).toContain("MACHINE_PLANNING_WO_EXISTS");
    expect(snapshotSvc).toContain("MACHINE_PLANNING_REOPENED");
    expect(snapshotSvc).toContain("ACTIVITY_ACTIONS.REOPENED");
    expect(snapshotSvc).toContain("MACHINE_PLANNING_HANDED_OFF");
  });

  it("STORE cannot reopen (write roles exclude STORE)", () => {
    expect(hasErpRole("STORE", WO_MACHINE_RUN_WRITE_ROLES)).toBe(false);
    expect(hasErpRole("PRODUCTION", WO_MACHINE_RUN_WRITE_ROLES)).toBe(true);
    expect(rmCheckSource).toContain("canReopen={canEditMachineRuns && !hasExistingWorkOrder}");
  });
});
