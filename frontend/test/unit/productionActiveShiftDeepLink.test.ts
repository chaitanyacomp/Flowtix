import { describe, expect, it } from "vitest";
import {
  ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS,
  buildActiveShiftRunWorkspaceHref,
  resolveActiveShiftRunPrimaryAction,
  resolveActiveShiftWorkspaceCueFromGate,
} from "../../src/lib/activeShiftRunGuidance";
import { shiftLifecycleNextAction } from "../../src/lib/machineShiftSessionUi";

describe("productionActiveShiftDeepLink", () => {
  it("builds confirm-start workspace href with shift context", () => {
    const href = buildActiveShiftRunWorkspaceHref(
      {
        workOrderId: 101,
        workOrderLineId: 202,
        runAllocationId: 303,
        shiftSessionId: 404,
        runSegmentId: 505,
        machineId: 6,
        startConfirmationStatus: "PENDING",
      },
      "dashboard",
    );
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("workOrderId")).toBe("101");
    expect(params.get("workOrderLineId")).toBe("202");
    expect(params.get("runAllocationId")).toBe("303");
    expect(params.get("shiftSessionId")).toBe("404");
    expect(params.get("runSegmentId")).toBe("505");
    expect(params.get("focusConfirmStart")).toBe("1");
    expect(params.get("productionBucket")).toBe("inProgress");
  });

  it("builds record-production href when start is confirmed", () => {
    expect(
      resolveActiveShiftRunPrimaryAction({
        runAllocationId: 1,
        startConfirmationStatus: "CONFIRMED",
      }),
    ).toBe(ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION);

    const href = buildActiveShiftRunWorkspaceHref({
      workOrderId: 1,
      runAllocationId: 2,
      startConfirmationStatus: "CONFIRMED",
    });
    expect(new URLSearchParams(href.split("?")[1]).get("focusRecordProduction")).toBe("1");
  });

  it("stale focusConfirmStart after confirmed gate shows Record Production", () => {
    expect(
      resolveActiveShiftWorkspaceCueFromGate({
        loading: false,
        entryBlocked: false,
        confirmedRunCount: 1,
        focusConfirmStart: true,
        focusRecordProduction: false,
      }),
    ).toBe(ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION);

    expect(
      resolveActiveShiftWorkspaceCueFromGate({
        loading: true,
        entryBlocked: true,
        focusConfirmStart: true,
      }),
    ).toBe(ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START);

    expect(
      resolveActiveShiftRunPrimaryAction({
        runAllocationId: 55,
        startConfirmationStatus: "CONFIRMED",
      }),
    ).toBe(ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION);
  });

  it("Shift Production CTA uses confirmation status, not missing-status pending default", () => {
    expect(
      resolveActiveShiftRunPrimaryAction({
        runAllocationId: 55,
      }),
    ).toBe(ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START);

    expect(
      resolveActiveShiftRunPrimaryAction({
        runAllocationId: 55,
        startConfirmationStatus: "CONFIRMED",
        confirmationPending: false,
      }),
    ).toBe(ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION);
  });

  it("blocks prepare shift report lifecycle action while run segment is active", () => {
    expect(
      shiftLifecycleNextAction("SHIFT_ACTIVE", { canManage: true, activeRunSegment: true }),
    ).toEqual({ label: "Complete active production run first", action: "none" });
  });
});
