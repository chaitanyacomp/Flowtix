import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildWoPrepareGuidedStripModel,
  deriveWoPrepareWorkflowState,
  formatGuidedStripOwner,
  workflowOperationalStatusPresentation,
} from "../../src/lib/woPrepareWorkflowGuidance";
import { resolvePurgingPlanningPanelCopy } from "../../src/components/erp/WoPreparePurgingPlanningPanel";
import { estimateRunCapacityContext } from "../../src/lib/woRunCapacityEstimate";
import { REGULAR_SO_WO_CREATE_ROLES, hasErpRole } from "../../src/config/erpRoles";
import { REGULAR_TERMS } from "../../src/lib/flowTerminology";

const rmCheckSource = readFileSync(resolve(__dirname, "../../src/pages/RmCheckPage.tsx"), "utf8");

describe("machine planning workspace stages", () => {
  it("covers four planning stages before Ready for WO", () => {
    expect(
      deriveWoPrepareWorkflowState({
        canCreateWorkOrder: true,
        hasRmShortage: false,
        hasPendingMr: false,
        hasExistingWorkOrder: false,
        allFgEnough: false,
        machinePlanningKey: "MACHINE_PLANNING_PENDING",
      }),
    ).toBe("MACHINE_PLANNING_PENDING");

    expect(
      deriveWoPrepareWorkflowState({
        canCreateWorkOrder: true,
        hasRmShortage: false,
        hasPendingMr: false,
        hasExistingWorkOrder: false,
        allFgEnough: false,
        machinePlanningKey: "MACHINE_PLANNING_IN_PROGRESS",
      }),
    ).toBe("MACHINE_PLANNING_IN_PROGRESS");

    expect(
      deriveWoPrepareWorkflowState({
        canCreateWorkOrder: true,
        hasRmShortage: false,
        hasPendingMr: false,
        hasExistingWorkOrder: false,
        allFgEnough: false,
        machinePlanningKey: "MACHINE_PLANNING_AWAITING_COMPLETION",
      }),
    ).toBe("MACHINE_PLANNING_AWAITING_COMPLETION");

    expect(
      deriveWoPrepareWorkflowState({
        canCreateWorkOrder: true,
        hasRmShortage: false,
        hasPendingMr: false,
        hasExistingWorkOrder: false,
        allFgEnough: false,
        machinePlanningKey: "MACHINE_PLANNING_COMPLETE",
      }),
    ).toBe("READY_FOR_WO");

    expect(workflowOperationalStatusPresentation("MACHINE_PLANNING_PENDING").label).toBe(
      "Machine Planning Pending",
    );
    expect(workflowOperationalStatusPresentation("MACHINE_PLANNING_AWAITING_COMPLETION").label).toBe(
      "Planning Valid — Awaiting Completion",
    );
  });

  it("Production never gets a normal Create Work Order action", () => {
    expect(hasErpRole("PRODUCTION", REGULAR_SO_WO_CREATE_ROLES)).toBe(false);
    const strip = buildWoPrepareGuidedStripModel({
      state: "READY_FOR_WO",
      salesOrderId: 1,
      pendingMrLabel: "",
      canRaiseMr: false,
      raisingMr: false,
      canStartWo: true,
      woCreateDisabled: false,
      loading: false,
      allowCreateWorkOrderAction: false,
      onRaiseMr: () => {},
      onCreateWo: () => {},
      onResumeWo: () => {},
      onRefreshAvailability: () => {},
    });
    expect(strip?.primaryLabel).not.toBe("Create Work Order");
    expect(strip?.headline).toMatch(/Handed to Store/i);
  });

  it("awaiting completion strip is Not Ready for WO", () => {
    const strip = buildWoPrepareGuidedStripModel({
      state: "MACHINE_PLANNING_AWAITING_COMPLETION",
      salesOrderId: 1,
      pendingMrLabel: "",
      canRaiseMr: false,
      raisingMr: false,
      canStartWo: true,
      woCreateDisabled: false,
      loading: false,
      onRaiseMr: () => {},
      onCreateWo: () => {},
      onResumeWo: () => {},
      onRefreshAvailability: () => {},
    });
    expect(strip?.headline).toBe("Planning Valid — Awaiting Completion");
    expect(strip?.primaryLabel).toBe("Complete Machine Planning");
    expect(strip?.nextActionText).toMatch(/Not Ready for WO/);
  });
});

describe("purging panel copy", () => {
  it("uses awaiting-runs copy for new plans; legacy only for historical WOs", () => {
    const awaiting = resolvePurgingPlanningPanelCopy({
      purgingDetectionSource: "AWAITING_RUNS",
      productionRunCount: 0,
    });
    expect(awaiting.helperText).toBe("Purging will be calculated after machine runs are allocated.");
    expect(awaiting.isLegacy).toBe(false);

    const legacy = resolvePurgingPlanningPanelCopy({
      purgingDetectionSource: "LEGACY_NOT_PLANNED",
      purgingDetectionLabel: "Not planned / legacy record",
      productionRunCount: 0,
    });
    expect(legacy.isLegacy).toBe(true);
    expect(legacy.helperText).toMatch(/Legacy Work Order/);
  });
});

describe("owner label and capacity", () => {
  it("formats Store Department without doubling", () => {
    expect(formatGuidedStripOwner("Store Department")).toBe("Store Department");
    expect(formatGuidedStripOwner("Production")).toBe("Production Department");
  });

  it("multi-shift capacity shows estimated shifts without rejecting continuous run", () => {
    // 8h shift; qty needs ~2 shifts at 95% efficiency.
    const cap = estimateRunCapacityContext({
      plannedQty: 3600,
      cycleTimeSeconds: 10,
      piecesPerCycle: 1,
      standardEfficiencyPercent: 95,
      shift: { startTime: "08:00", endTime: "16:00", plannedBreakMinutes: 0 },
      plannedDate: "2026-08-23",
    });
    expect(cap.estimatedHours).toBeGreaterThan(8);
    expect(cap.exceedsOneShift).toBe(true);
    expect(cap.estimatedShiftsRequired).toBeGreaterThanOrEqual(2);
    expect(cap.warning).toMatch(/shift/i);
    expect(cap.expectedCompletionLabel).toBeTruthy();
  });
});

describe("RmCheck Production intent title", () => {
  it("titles machine-planning intent as Machine Run Planning", () => {
    expect(REGULAR_TERMS.MACHINE_RUN_PLANNING_TITLE).toBe("Machine Run Planning");
    expect(rmCheckSource).toContain("MACHINE_RUN_PLANNING_SUBTITLE");
    expect(rmCheckSource).toContain("useCompactMachinePlanning");
    expect(rmCheckSource).toContain("allowCreateWorkOrderAction: canCreateWoRole");
  });
});
