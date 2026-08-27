/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  shouldUseCompactMachinePlanningLayout,
  MACHINE_PLANNING_COMPACT_STAGE_KEYS,
} from "../../src/lib/machinePlanningLayout";

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

describe("shouldUseCompactMachinePlanningLayout — live Prepare Work Order wiring", () => {
  it("Admin + MACHINE_PLANNING_PENDING without intent uses compact (SO-26-0002 path)", () => {
    expect(
      shouldUseCompactMachinePlanningLayout({
        intentMachinePlanning: false,
        roleUpper: "ADMIN",
        machinePlanningKey: "MACHINE_PLANNING_PENDING",
      }),
    ).toBe(true);
  });

  it("Admin without intent and no machine-planning stage stays classic (Ready for WO / Store create)", () => {
    expect(
      shouldUseCompactMachinePlanningLayout({
        intentMachinePlanning: false,
        roleUpper: "ADMIN",
        machinePlanningKey: "MACHINE_PLANNING_COMPLETE",
      }),
    ).toBe(false);
    expect(
      shouldUseCompactMachinePlanningLayout({
        intentMachinePlanning: false,
        roleUpper: "STORE",
        machinePlanningKey: null,
      }),
    ).toBe(false);
  });

  it("intent or PRODUCTION always compact", () => {
    expect(
      shouldUseCompactMachinePlanningLayout({
        intentMachinePlanning: true,
        roleUpper: "ADMIN",
        machinePlanningKey: null,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactMachinePlanningLayout({
        intentMachinePlanning: false,
        roleUpper: "PRODUCTION",
        machinePlanningKey: null,
      }),
    ).toBe(true);
  });

  it("covers all active compact stage keys", () => {
    for (const key of MACHINE_PLANNING_COMPACT_STAGE_KEYS) {
      expect(
        shouldUseCompactMachinePlanningLayout({
          intentMachinePlanning: false,
          roleUpper: "ADMIN",
          machinePlanningKey: key,
        }),
      ).toBe(true);
    }
  });
});

describe("RmCheckPage mounts compact for machine-planning stages (no dual layout)", () => {
  it("gates layout with shouldUseCompactMachinePlanningLayout and live machinePlanning.key", () => {
    expect(rmCheckSource).toContain("shouldUseCompactMachinePlanningLayout");
    expect(rmCheckSource).toContain("machinePlanningKey: data?.machinePlanning?.key");
    expect(rmCheckSource).toContain("useCompactMachinePlanning ? (");
    // Exclusive branch — compact workspace vs classic header
    expect(rmCheckSource).toContain('data-testid="machine-run-planning-compact-workspace"');
    expect(rmCheckSource).toContain("<WoPrepareOperationalHeader");
  });

  it("compact branch markers present; legacy headings only outside compact exclusive render", () => {
    expect(allocationSource).toContain("Allocate production to a machine");
    expect(allocationSource).toContain("Add Machine Run");
    expect(compactSource).toContain("Material Readiness");
    expect(compactSource).toContain("+ Add production buffer");

    const compactStart = rmCheckSource.indexOf('data-testid="machine-run-planning-compact-workspace"');
    const classicHeader = rmCheckSource.indexOf("<WoPrepareOperationalHeader", compactStart);
    expect(compactStart).toBeGreaterThan(-1);
    expect(classicHeader).toBeGreaterThan(compactStart);
    const compactBranch = rmCheckSource.slice(compactStart, classicHeader);

    expect(compactBranch).toContain("MachineRunPlanningContextStrip");
    expect(compactBranch).toContain("MachineRunCombinedRmSummary");
    expect(compactBranch).toContain("MachineRunPlanningActionBar");
    expect(compactBranch).toContain("compactCapacity");
    // Legacy panels must not mount inside the compact exclusive branch
    expect(compactBranch).not.toContain("WoPrepareProductionPlanningPanel");
    expect(compactBranch).not.toContain("WoPreparePurgingPlanningPanel");
    expect(compactBranch).not.toContain("WoPrepareRmReadinessTable");
    expect(compactBranch).not.toContain("wo-machine-planning-actions");
    expect(compactBranch).not.toContain("PRODUCTION PLANNING");
    expect(compactBranch).not.toContain("MACHINE PRODUCTION RUNS");
    expect(compactBranch).not.toContain("PURGING RM");
    expect(compactBranch).not.toContain("RM READINESS");
  });

  it("legacy classic panels remain only in the non-compact else branch", () => {
    const classicHeader = rmCheckSource.indexOf("<WoPrepareOperationalHeader");
    const classicBranch = rmCheckSource.slice(classicHeader);
    expect(classicBranch).toContain("WoPrepareProductionPlanningPanel");
    expect(classicBranch).toContain("WoPreparePurgingPlanningPanel");
    expect(classicBranch).toContain("WoPrepareRmReadinessTable");
    expect(classicBranch).toContain("wo-machine-planning-actions");
  });

  it("Admin READY_FOR_WO completed planning uses confirmation layout (not classic duplicates)", () => {
    expect(rmCheckSource).toContain("shouldUseReadyForWoConfirmationLayout");
    expect(rmCheckSource).toContain("useReadyForWoConfirmation ? (");
    expect(rmCheckSource).toContain("RegularSoReadyForWoConfirmation");
    const confirmStart = rmCheckSource.indexOf('data-testid="ready-for-wo-confirmation"');
    // Wired via component; page mounts confirmation with Create WO + no classic header in that branch
    expect(rmCheckSource).toContain("<RegularSoReadyForWoConfirmation");
    const confirmMount = rmCheckSource.indexOf("<RegularSoReadyForWoConfirmation");
    const classicHeader = rmCheckSource.indexOf("<WoPrepareOperationalHeader", confirmMount);
    expect(confirmMount).toBeGreaterThan(-1);
    expect(classicHeader).toBeGreaterThan(confirmMount);
    const confirmBranch = rmCheckSource.slice(confirmMount, classicHeader);
    expect(confirmBranch).not.toContain("WoPrepareProductionPlanningPanel");
    expect(confirmBranch).not.toContain("WoPreparePurgingPlanningPanel");
    expect(confirmBranch).not.toContain("WoPrepareWorkflowProgress");
    expect(confirmBranch).not.toContain("WoPrepareReadinessChecklist");
    void confirmStart;
  });
});
