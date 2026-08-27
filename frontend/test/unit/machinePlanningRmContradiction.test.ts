import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  machinePlanningStageBadge,
  summarizeAuthoritativeRmReadiness,
} from "../../src/lib/machinePlanningRmReadiness";
import { deriveWoPrepareWorkflowState, deriveWoPrepareWorkflowStepLabel } from "../../src/lib/woPrepareWorkflowGuidance";
import { getPageTitle } from "../../src/lib/routeTitles";
import { REGULAR_TERMS } from "../../src/lib/flowTerminology";

const root = resolve(__dirname, "../..");
const rmCheckSource = readFileSync(resolve(root, "src/pages/RmCheckPage.tsx"), "utf8");
const compactSource = readFileSync(
  resolve(root, "src/components/erp/MachineRunPlanningCompact.tsx"),
  "utf8",
);

describe("authoritative RM readiness — no contradictory shortage", () => {
  it("shortage 0 with available > required → RM Available, never RM Shortage", () => {
    const r = summarizeAuthoritativeRmReadiness(
      [{ requiredQty: 71.6, availableQty: 75, shortageQty: 0, shortage: 0 }],
      { machinePlanningComplete: false, storeCanCreateWorkOrder: false },
    );
    expect(r.hasShortage).toBe(false);
    expect(r.rmLabel).toBe("RM Available");
    expect(r.rmLabel).not.toBe("RM Shortage");
  });

  it("does not treat canCreateWorkOrder=false (machine gate) as RM Shortage", () => {
    const r = summarizeAuthoritativeRmReadiness(
      [{ requiredQty: 71.6, availableQty: 75, shortageQty: 0 }],
      { machinePlanningComplete: false, storeCanCreateWorkOrder: false },
    );
    expect(r.rmLabel).toBe("RM Available");
  });

  it("Ready for WO only after handoff + store gate", () => {
    const before = summarizeAuthoritativeRmReadiness(
      [{ requiredQty: 10, availableQty: 10, shortageQty: 0 }],
      { machinePlanningComplete: false, storeCanCreateWorkOrder: true },
    );
    expect(before.rmLabel).toBe("RM Available");

    const after = summarizeAuthoritativeRmReadiness(
      [{ requiredQty: 10, availableQty: 10, shortageQty: 0 }],
      { machinePlanningComplete: true, storeCanCreateWorkOrder: true },
    );
    expect(after.rmLabel).toBe("Ready for WO");
  });

  it("uses shortageQty when shortage field is stale/positive but shortageQty is 0", () => {
    // Table displays shortageQty ?? shortage; authoritative helper must prefer shortageQty.
    const r = summarizeAuthoritativeRmReadiness(
      [{ requiredQty: 71.6, availableQty: 75, shortageQty: 0, shortage: 71.6 }],
      { machinePlanningComplete: false },
    );
    expect(r.hasShortage).toBe(false);
    expect(r.rmLabel).toBe("RM Available");
  });

  it("awaiting completion stage stays Planning Valid even when RM available", () => {
    const state = deriveWoPrepareWorkflowState({
      canCreateWorkOrder: false,
      hasRmShortage: false,
      hasPendingMr: false,
      hasExistingWorkOrder: false,
      allFgEnough: false,
      machinePlanningKey: "MACHINE_PLANNING_AWAITING_COMPLETION",
      machinePlanningComplete: false,
    });
    expect(state).toBe("MACHINE_PLANNING_AWAITING_COMPLETION");
    expect(machinePlanningStageBadge({ machinePlanningKey: state }).label).toBe(
      "Planning Valid — Awaiting Completion",
    );
    expect(state).not.toBe("READY_FOR_WO");
    expect(state).not.toBe("NO_MR");
  });

  it("workflow step label does not force RM Shortage when stock is fine during planning", () => {
    const step = deriveWoPrepareWorkflowStepLabel({
      workflowState: "MACHINE_PLANNING_AWAITING_COMPLETION",
      canCreateWorkOrder: false,
      hasRmShortage: false,
      hasPendingMr: false,
      hasExistingWorkOrder: false,
      allRmAvailable: true,
    });
    expect(step).not.toBe("RM Shortage");
    expect(step).toBe("RM Received in Store");
  });
});

describe("compact Machine Run Planning page contract", () => {
  it("titles Machine Run Planning and uses compact workspace markers", () => {
    expect(REGULAR_TERMS.MACHINE_RUN_PLANNING_TITLE).toBe("Machine Run Planning");
    expect(getPageTitle("/work-orders/prepare", "?intent=machine-planning")).toBe(
      "Machine Run Planning",
    );
    expect(rmCheckSource).toContain("useCompactMachinePlanning");
    expect(rmCheckSource).toContain('roleUpper === "PRODUCTION"');
    expect(rmCheckSource).toContain("summarizeAuthoritativeRmReadiness");
    expect(rmCheckSource).toContain("machinePlanningStageBadge");
    expect(rmCheckSource).toContain("MachineRunCombinedRmSummary");
    expect(rmCheckSource).toContain("MachineRunPlanningActionBar");
    expect(compactSource).toContain('data-testid="machine-planning-rm-badge"');
    // Approved sticky-bar back control: short "Back" label + hub test id (not long hub copy).
    expect(compactSource).toContain('data-testid="machine-planning-back-hub"');
    expect(compactSource).toMatch(/>\s*Back\s*</);
    expect(rmCheckSource).not.toContain('data-testid="machine-run-planning-page-title"');
  });

  it("hides Store WO chrome during Production compact planning", () => {
    expect(rmCheckSource).toContain("useCompactMachinePlanning ? (");
    expect(rmCheckSource).toContain("machine-run-planning-compact-workspace");
    expect(rmCheckSource).toContain("MachineRunCombinedRmSummary");
    expect(rmCheckSource).toContain("MachineRunPlanningActionBar");
    expect(rmCheckSource).not.toContain("OPEN_RM_CONTROL_CENTER");
    // Compact workspace JSX must not nest Workflow Status / readiness / purging panels.
    expect(rmCheckSource).toMatch(
      /machine-run-planning-compact-workspace[\s\S]*?MachineRunPlanningActionBar[\s\S]*?WoPrepareOperationalHeader/,
    );
    const compactToPrepare = rmCheckSource.slice(
      rmCheckSource.indexOf("machine-run-planning-compact-workspace"),
      rmCheckSource.indexOf("<WoPrepareOperationalHeader"),
    );
    expect(compactToPrepare).not.toContain("WoPrepareWorkflowProgress");
    expect(compactToPrepare).not.toContain("WoPrepareReadinessChecklist");
    expect(compactToPrepare).not.toContain("WoPrepareGuidedStrip");
    expect(compactToPrepare).not.toContain("WoPreparePurgingPlanningPanel");
    expect(rmCheckSource).toContain("Sticky action bar owns hub navigation");
  });

  it("prepare path also suppresses Workflow Status while machine planning incomplete", () => {
    expect(rmCheckSource).toContain("WoPrepareWorkflowProgress");
    expect(rmCheckSource).toContain('workflowState === "MACHINE_PLANNING_AWAITING_COMPLETION" ? null');
  });
});
