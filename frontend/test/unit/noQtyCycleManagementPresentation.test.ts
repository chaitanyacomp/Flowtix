import { describe, expect, it } from "vitest";
import {
  resolveCycleManagementCurrentCycleStatus,
  resolveNoQtyCycleManagementPrimaryAction,
} from "../../src/lib/noQtyCycleManagementPresentation";
import type { NoQtyPlannerInboxRow } from "../../src/hooks/useNoQtyPlannerInbox";

function baseRow(overrides: Partial<NoQtyPlannerInboxRow> = {}): NoQtyPlannerInboxRow {
  return {
    so: {
      id: 101,
      docNo: "SO-26-0001",
      processStage: { key: "NO_QTY_REQUIREMENT_READY", label: "RS locked" },
      noQtyCreateNextRsEligible: false,
      noQtyNextPossibleCycleNo: 3,
      noQtyNextRsAlreadyCreatedDocNo: null,
    },
    rsStatus: "Locked",
    lockedPeriodKey: "2026-05",
    flowState: null,
    guidedCycleId: 10,
    cycleNo: 2,
    ...overrides,
  };
}

describe("noQtyCycleManagementPresentation", () => {
  it("never returns duplicate Open Current RS alongside Open Requirement Sheet", () => {
    const action = resolveNoQtyCycleManagementPrimaryAction(baseRow(), {
      canOpenRs: true,
      canCreateNextRs: false,
    });
    expect(action.label).not.toBe("Open Current RS");
    expect(action.label).toMatch(/Cycle 2 Requirement Sheet|Monthly Planning|Place WO|Blocked|Create/);
  });

  it("returns create next RS when eligible", () => {
    const action = resolveNoQtyCycleManagementPrimaryAction(
      baseRow({
        so: {
          id: 101,
          noQtyCreateNextRsEligible: true,
          noQtyNextPossibleCycleNo: 3,
        },
      }),
      { canOpenRs: true, canCreateNextRs: true },
    );
    expect(action.label).toBe("Create Cycle 3 Requirement Sheet");
    expect(action.href).toContain("intent=add");
  });

  it("returns open next RS when next cycle sheet already exists", () => {
    const action = resolveNoQtyCycleManagementPrimaryAction(
      baseRow({
        so: {
          id: 101,
          noQtyNextRsAlreadyCreatedDocNo: "RS-26-0009",
          noQtyNextPossibleCycleNo: 3,
        },
      }),
      { canOpenRs: true, canCreateNextRs: true },
    );
    expect(action.label).toBe("Open Cycle 3 Requirement Sheet");
    expect(action.disabled).not.toBe(true);
  });

  it("returns blocked primary when next RS is blocked", () => {
    const action = resolveNoQtyCycleManagementPrimaryAction(
      baseRow({
        so: {
          id: 101,
          noQtyCreateNextRsEligible: false,
          noQtyCreateNextRsBlockReason: "NO_LOCKED_RS",
        },
      }),
      { canOpenRs: true, canCreateNextRs: true },
    );
    expect(action.label).toBe("Next RS Blocked");
    expect(action.disabled).toBe(true);
    expect(action.blockedReason).toBeTruthy();
  });

  it("summarizes current cycle card without navigation", () => {
    const status = resolveCycleManagementCurrentCycleStatus(
      baseRow({
        rsStatus: "Locked",
        rmCoverageLabel: "Shortage",
        flowState: {
          salesOrderId: 101,
          cycleId: 10,
          requirementExists: true,
          requirementLocked: true,
          workOrderExists: false,
          workOrderId: null,
          productionExists: false,
          qcExists: false,
          dispatchExists: false,
          salesBillExists: false,
          nextAction: "WORK_ORDER",
          activeStep: 3,
          readyToPlaceWo: false,
        },
      }),
    );
    expect(status.cycle).toContain("Cycle");
    expect(status.rsStatus).toBe("Locked");
    expect(status.procurement).toBe("Shortage");
    expect(status.monthlyPlanning).toBe("Pending");
  });
});
