import { describe, expect, it } from "vitest";
import {
  ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS,
  formatActiveShiftRunningTime,
  pickActiveShiftRunsFromQueue,
  workbenchPrimaryActionLabelForActiveShift,
} from "../../src/lib/activeShiftRunGuidance";
import {
  classifyProductionWorkbenchState,
  workbenchRowPrimaryActionLabel,
} from "../../src/lib/productionWorkbenchState";

describe("activeShiftRunGuidance (frontend)", () => {
  it("active segment overrides Ready-to-Start wording on workbench CTA", () => {
    const row = {
      workOrderId: 1,
      balanceQty: 100,
      producedQty: 0,
      canAcceptProductionEntry: true,
      productionWorkState: "READY_TO_START" as const,
      actionLabel: "Ready to Start Production",
      activeShiftRun: {
        primaryActionLabel: ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START,
        confirmationPending: true,
      },
    };
    expect(classifyProductionWorkbenchState(row)).toBe("CONTINUE_PRODUCTION");
    expect(workbenchRowPrimaryActionLabel(row)).toBe("Confirm Machine Start");
    expect(workbenchRowPrimaryActionLabel(row)).not.toBe("Start Production");
  });

  it("pending confirmation CTA", () => {
    expect(
      workbenchPrimaryActionLabelForActiveShift(
        { primaryActionLabel: "Confirm Machine Start", confirmationPending: true },
        "Start Production",
      ),
    ).toBe("Confirm Machine Start");
  });

  it("confirmed CTA", () => {
    expect(
      workbenchPrimaryActionLabelForActiveShift(
        { primaryActionLabel: "Record Production", confirmationPending: false },
        "Continue Production",
      ),
    ).toBe("Record Production");
  });

  it("Open Active Shift deep-link is present on guidance payload", () => {
    const runs = pickActiveShiftRunsFromQueue([
      {
        activeShiftRun: {
          shiftSessionId: 7,
          runSegmentId: 9,
          machineId: 3,
          workOrderId: 1001,
          primaryActionLabel: "Record Production",
          shiftSessionHref: "/shift-production/sessions/7",
          workspaceHref: "/production?workOrderId=1001&shiftSessionId=7",
        },
      },
      {
        activeShiftRun: {
          shiftSessionId: 7,
          runSegmentId: 9,
          machineId: 3,
          workOrderId: 1001,
          primaryActionLabel: "Record Production",
          shiftSessionHref: "/shift-production/sessions/7",
        },
      },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].shiftSessionHref).toBe("/shift-production/sessions/7");
  });

  it("no active shift retains normal Ready-to-Start behaviour", () => {
    const row = {
      workOrderId: 2,
      balanceQty: 50,
      producedQty: 0,
      canAcceptProductionEntry: true,
      productionWorkState: "READY_TO_START" as const,
      actionLabel: "Ready to Start Production",
    };
    expect(classifyProductionWorkbenchState(row)).toBe("READY_TO_START");
    expect(workbenchRowPrimaryActionLabel(row)).toBe("Start Production");
  });

  it("formats running time", () => {
    const started = new Date("2026-08-26T10:00:00.000Z").toISOString();
    const now = new Date("2026-08-26T11:05:00.000Z").getTime();
    expect(formatActiveShiftRunningTime(started, now)).toBe("1h 5m");
  });
});
