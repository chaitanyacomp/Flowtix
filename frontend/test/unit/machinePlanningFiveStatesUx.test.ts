/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { machinePlanningCompleteDisabledReason } from "../../src/components/erp/MachineRunPlanningCompact";

const root = resolve(__dirname, "../..");
const compactSource = readFileSync(
  resolve(root, "src/components/erp/MachineRunPlanningCompact.tsx"),
  "utf8",
);
const allocationSource = readFileSync(
  resolve(root, "src/components/erp/WoPrepareProductionRunAllocationPanel.tsx"),
  "utf8",
);
const rmCheckSource = readFileSync(resolve(root, "src/pages/RmCheckPage.tsx"), "utf8");

describe("Machine planning progressive UI — five states", () => {
  it("1) No runs: Add Machine Run is the primary empty-state action", () => {
    expect(allocationSource).toContain('return "no-runs"');
    expect(allocationSource).toContain("data-machine-planning-state={state}");
    expect(allocationSource).toContain('data-testid="machine-planning-empty-runs"');
    expect(allocationSource).toContain("Add Machine Run");
    expect(allocationSource).toContain("Allocate production to a machine");
    expect(allocationSource).toContain('data-testid="machine-planning-task-heading"');
    expect(allocationSource).toContain('data-testid="machine-planning-tech-help"');
    expect(machinePlanningCompleteDisabledReason({
      runCount: 0,
      allocationError: "Add at least one machine production-run allocation.",
      plannedQty: 15000,
      allocatedQty: 0,
    })).toMatch(/Add a machine run/i);
  });

  it("2) Partial allocation: remaining qty + Complete stays disabled with plain reason", () => {
    expect(allocationSource).toContain('return "partial"');
    expect(allocationSource).toContain("machine-planning-remaining-qty");
    expect(allocationSource).toContain("Allocate the remaining");
    const reason = machinePlanningCompleteDisabledReason({
      runCount: 1,
      allocationError: "Allocated quantity must equal planned WO quantity.",
      plannedQty: 15000,
      allocatedQty: 5000,
    });
    expect(reason).toMatch(/Allocate remaining 10000/i);
    expect(compactSource).toContain("completeDisabledReason");
    expect(compactSource).toContain('data-testid="machine-planning-complete-reason"');
    expect(rmCheckSource).toContain("machinePlanningCompleteDisabledReason");
  });

  it("3) Fully allocated: Complete Machine Planning becomes enabled primary", () => {
    expect(allocationSource).toContain('return "fully-allocated"');
    expect(allocationSource).toContain("Allocation matches planned qty");
    expect(
      machinePlanningCompleteDisabledReason({
        runCount: 1,
        allocationError: null,
        plannedQty: 15000,
        allocatedQty: 15000,
      }),
    ).toBeNull();
    expect(compactSource).toContain("Complete Machine Planning");
    expect(rmCheckSource).toContain("completeDisabledReason={completeDisabledReason}");
  });

  it("4) Completed planning: read-only handoff to Store for WO creation", () => {
    expect(compactSource).toContain("Planning complete");
    expect(compactSource).toContain("Handed to");
    expect(compactSource).toContain("for Work Order creation");
    expect(compactSource).toContain('data-testid="machine-planning-handoff-strip"');
    expect(compactSource).toContain("Reopen Planning");
    expect(rmCheckSource).toContain("showEditActions={canMutatePlanning}");
    expect(rmCheckSource).toContain("readOnly={!canMutatePlanning}");
  });

  it("5) RM shortage vs ready: Material Readiness badge + handoff RM copy", () => {
    expect(compactSource).toContain("Material Readiness");
    expect(compactSource).toContain('data-testid="machine-planning-material-readiness-badge"');
    expect(compactSource).toContain("Ready for Work Order");
    expect(compactSource).toContain("RM shortage — Store action needed");
    expect(compactSource).toContain("Purging will be calculated after machine allocation");
    expect(compactSource).toContain("View calculation");
    expect(rmCheckSource).toContain("overallRmLabel={rmReady.rmLabel}");
  });
});

describe("Machine planning viewport layout contracts", () => {
  it("keeps slim header fields and hides zero buffer/adj duplication", () => {
    expect(compactSource).toContain("Customer Qty");
    expect(compactSource).toContain("Planned Qty");
    expect(compactSource).toContain("+ Add production buffer");
    expect(compactSource).toContain("machine-planning-add-buffer");
    expect(compactSource).toContain("machine-planning-buffer-qty");
    expect(compactSource).not.toContain("Additional Qty");
    expect(compactSource).not.toContain("Next Owner");
    expect(compactSource).not.toContain("BOM revision");
  });

  it("uses single sticky action bar without scattered Complete duplicates in compact path", () => {
    expect(compactSource).toContain("erp-sticky-workflow-bar");
    expect(compactSource).toContain('data-testid="machine-planning-back-hub"');
    expect(compactSource).toMatch(/>\s*Back\s*</);
    expect(compactSource).toContain("Save Draft");
    expect(rmCheckSource).toContain("MachineRunPlanningActionBar");
    const compactStart = rmCheckSource.indexOf('data-testid="machine-run-planning-compact-workspace"');
    const classicHeader = rmCheckSource.indexOf("<WoPrepareOperationalHeader", compactStart);
    expect(compactStart).toBeGreaterThan(-1);
    expect(classicHeader).toBeGreaterThan(compactStart);
    const intentBranch = rmCheckSource.slice(compactStart, classicHeader);
    expect(intentBranch).toContain("MachineRunPlanningActionBar");
    expect(intentBranch).not.toContain("WoPreparePurgingPlanningPanel");
    expect(intentBranch).not.toContain("WoPrepareRmReadinessTable");
    expect(intentBranch).not.toContain("WoPrepareProductionPlanningPanel");
  });

  it("shows allocated summary and one Add Machine Run primary in empty state", () => {
    expect(allocationSource).toContain("machine-planning-allocated-summary");
    expect(allocationSource).toContain("Allocated");
    expect(allocationSource).toMatch(/machine-planning-empty-runs[\s\S]*Add Machine Run/);
  });
});
