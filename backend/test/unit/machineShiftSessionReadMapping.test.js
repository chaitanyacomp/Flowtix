const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { mapSessionDetail } = require("../../src/services/machineShiftSessionReadService");
const { ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS } = require("../../src/services/activeShiftRunGuidanceService");
const { SHIFT_OVERDUE_MESSAGE } = require("../../src/services/shiftOverdueGuidance");

function sessionFixture(overrides = {}) {
  return {
    id: 7,
    shiftSessionNo: "SS-26-0004",
    status: "OPEN",
    sessionDate: "2026-08-26",
    machine: { id: 3, machineCode: "INJ-01", machineName: "Injection 01" },
    shift: { id: 1, shiftCode: "A", shiftName: "Morning A", startTime: "06:00", endTime: "14:00" },
    primaryOperator: { id: 1, operatorName: "Ramesh Kumar", operatorCode: "OP-01" },
    handoverState: null,
    handoverRemarks: null,
    cancellationReason: null,
    startedAt: new Date("2026-08-26T06:05:00+05:30"),
    startedByUserId: 1,
    endedAt: null,
    endedByUserId: null,
    reopenCount: 0,
    sessionOperators: [],
    runSegments: [
      {
        id: 9,
        segmentNo: 1,
        status: "ACTIVE",
        workOrderId: 1001,
        runAllocationId: 55,
        segmentStartedAt: new Date("2026-08-26T06:10:00+05:30"),
        closedAt: null,
        closeReason: null,
        closedByUserId: null,
        workOrder: { id: 1001, docNo: "WO-R-26-0001" },
        runAllocation: {
          id: 55,
          workOrderId: 1001,
          workOrderLineId: 200,
          startConfirmation: { id: 1, status: "CONFIRMED" },
        },
      },
    ],
    downtimeSegments: [],
    shiftReport: null,
    reopenRequests: [],
    ...overrides,
  };
}

describe("machineShiftSessionReadService mapping", () => {
  it("confirmed start maps Record Production and does not look pending", () => {
    const dto = mapSessionDetail(sessionFixture());
    const run = dto.runSegments[0];
    assert.equal(run.startConfirmationStatus, "CONFIRMED");
    assert.equal(run.confirmationPending, false);
    assert.equal(run.primaryActionLabel, ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION);
    assert.equal(run.workOrderLineId, 200);
  });

  it("pending start maps Confirm Machine Start", () => {
    const dto = mapSessionDetail(
      sessionFixture({
        runSegments: [
          {
            id: 9,
            segmentNo: 1,
            status: "ACTIVE",
            workOrderId: 1001,
            runAllocationId: 55,
            segmentStartedAt: new Date(),
            closedAt: null,
            workOrder: { id: 1001, docNo: "WO-R-26-0001" },
            runAllocation: {
              id: 55,
              workOrderId: 1001,
              workOrderLineId: 200,
              startConfirmation: null,
            },
          },
        ],
      }),
    );
    const run = dto.runSegments[0];
    assert.equal(run.startConfirmationStatus, null);
    assert.equal(run.confirmationPending, true);
    assert.equal(run.primaryActionLabel, ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START);
  });

  it("OPEN Morning A past scheduled end is overdue guidance only", () => {
    const dto = mapSessionDetail(sessionFixture(), null, new Date("2026-08-27T07:00:00+05:30"));
    assert.equal(dto.shiftOverdue, true);
    assert.equal(dto.shiftOverdueMessage, SHIFT_OVERDUE_MESSAGE);
    assert.ok(dto.shiftExpectedEndAt);
  });

  it("OPEN Morning A during the shift is not overdue", () => {
    const dto = mapSessionDetail(sessionFixture(), null, new Date("2026-08-26T13:00:00+05:30"));
    assert.equal(dto.shiftOverdue, false);
    assert.equal(dto.shiftOverdueMessage, null);
  });
});
