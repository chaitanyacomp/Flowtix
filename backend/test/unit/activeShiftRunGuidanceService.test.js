const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS,
  OPEN_ACTIVE_SHIFT_LABEL,
  applyActiveShiftRunGuidanceToPendingActions,
  attachActiveShiftRunGuidanceToProductionQueueRows,
  buildActiveShiftRunWorkspaceHref,
  buildActiveShiftSessionHref,
  mapActiveRunSegmentToGuidance,
  resolveActiveShiftRunPrimaryAction,
  shouldOverrideProductionActionLabel,
  SHIFT_OVERDUE_MESSAGE,
} = require("../../src/services/activeShiftRunGuidanceService");
const { PRODUCTION_EXECUTION_PENDING_LABELS } = require("../../src/services/productionExecutionService");

describe("activeShiftRunGuidanceService", () => {
  it("pending confirmation CTA is Confirm Machine Start", () => {
    assert.equal(
      resolveActiveShiftRunPrimaryAction({
        runAllocationId: 10,
        startConfirmationStatus: null,
      }),
      ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START,
    );
  });

  it("confirmed CTA is Record Production", () => {
    assert.equal(
      resolveActiveShiftRunPrimaryAction({
        runAllocationId: 10,
        startConfirmationStatus: "CONFIRMED",
      }),
      ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION,
    );
  });

  it("legacy WO without run allocation records production (no confirm gate)", () => {
    assert.equal(
      resolveActiveShiftRunPrimaryAction({
        runAllocationId: null,
        startConfirmationStatus: null,
      }),
      ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION,
    );
  });

  it("Open Active Shift deep-links to session workspace", () => {
    assert.equal(buildActiveShiftSessionHref(42), "/shift-production/sessions/42");
  });

  it("workspace href carries WO/run/session/segment and does not strip workOrderId", () => {
    const href = buildActiveShiftRunWorkspaceHref(
      {
        workOrderId: 1001,
        workOrderLineId: 200,
        runAllocationId: 55,
        shiftSessionId: 7,
        runSegmentId: 9,
        machineId: 3,
        primaryActionLabel: ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START,
      },
      "pending-actions",
    );
    assert.match(href, /workOrderId=1001/);
    assert.match(href, /runAllocationId=55/);
    assert.match(href, /shiftSessionId=7/);
    assert.match(href, /runSegmentId=9/);
    assert.match(href, /focusConfirmStart=1/);
    assert.match(href, /pwSection=active/);
    assert.doesNotMatch(href, /pwFocus=/);
  });

  it("active segment overrides Ready-to-Start wording on queue rows", () => {
    const guidance = mapActiveRunSegmentToGuidance({
      id: 9,
      status: "ACTIVE",
      sessionId: 7,
      machineId: 3,
      runAllocationId: 55,
      workOrderId: 1001,
      segmentNo: 1,
      segmentStartedAt: new Date("2026-08-26T10:00:00.000Z"),
      session: {
        id: 7,
        status: "OPEN",
        shiftSessionNo: "SS-26-0004",
        machineId: 3,
        primaryOperatorId: 1,
        machine: { id: 3, machineCode: "INJ-01", machineName: "Injection 01" },
        shift: { id: 1, shiftCode: "A", shiftName: "Morning A" },
        primaryOperator: { id: 1, operatorName: "Ramesh Kumar", operatorCode: "OP-01" },
      },
      workOrder: { id: 1001, docNo: "WO-R-26-0001" },
      runAllocation: {
        id: 55,
        workOrderId: 1001,
        workOrderLineId: 200,
        startConfirmation: null,
        workOrder: { id: 1001, docNo: "WO-R-26-0001" },
      },
    }, new Date("2026-08-26T11:00:00.000Z"));

    assert.ok(guidance);
    assert.equal(guidance.primaryActionLabel, ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START);
    assert.equal(guidance.secondaryActionLabel, OPEN_ACTIVE_SHIFT_LABEL);
    assert.equal(guidance.machineCode, "INJ-01");
    assert.equal(guidance.shiftName, "Morning A");
    assert.equal(guidance.operatorName, "Ramesh Kumar");
    assert.equal(guidance.workOrderNo, "WO-R-26-0001");

    const rows = [
      {
        workOrderId: 1001,
        workOrderLineId: 200,
        productionWorkState: "READY_TO_START",
        actionLabel: PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED,
        actionHref: "/production?pwFocus=1001&productionBucket=readyToStart",
      },
    ];
    attachActiveShiftRunGuidanceToProductionQueueRows(rows, [guidance]);
    assert.equal(rows[0].actionLabel, ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START);
    assert.equal(rows[0].productionWorkState, "CONTINUE_PRODUCTION");
    assert.match(rows[0].actionHref, /runAllocationId=55/);
    assert.notEqual(rows[0].actionLabel, PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED);
  });

  it("confirmed active segment uses Record Production on pending actions overlay", () => {
    const guidance = mapActiveRunSegmentToGuidance({
      id: 9,
      status: "ACTIVE",
      sessionId: 7,
      machineId: 3,
      runAllocationId: 55,
      workOrderId: 1001,
      segmentNo: 1,
      segmentStartedAt: new Date(),
      session: {
        id: 7,
        status: "OPEN",
        shiftSessionNo: "SS-26-0004",
        machineId: 3,
        primaryOperatorId: 1,
        machine: { id: 3, machineCode: "INJ-01", machineName: "Injection 01" },
        shift: { id: 1, shiftCode: "A", shiftName: "Morning A" },
        primaryOperator: { id: 1, operatorName: "Ramesh Kumar", operatorCode: "OP-01" },
      },
      workOrder: { id: 1001, docNo: "WO-R-26-0001" },
      runAllocation: {
        id: 55,
        workOrderId: 1001,
        workOrderLineId: 200,
        startConfirmation: { id: 1, status: "CONFIRMED" },
        workOrder: { id: 1001, docNo: "WO-R-26-0001" },
      },
    });
    assert.equal(guidance.primaryActionLabel, ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION);

    const actions = applyActiveShiftRunGuidanceToPendingActions(
      [
        {
          id: "production:wo:1001:line:200",
          action: PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED,
          href: "/production?pwFocus=1001&productionBucket=readyToStart",
          documentNo: "WO-R-26-0001",
        },
      ],
      [guidance],
    );
    assert.equal(actions[0].action, ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION);
    assert.match(actions[0].href, /focusRecordProduction=1/);
    assert.match(actions[0].href, /shiftSessionId=7/);
  });

  it("no active shift retains Ready-to-Start behaviour", () => {
    const rows = [
      {
        workOrderId: 88,
        productionWorkState: "READY_TO_START",
        actionLabel: PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED,
        actionHref: "/production?pwFocus=88",
      },
    ];
    attachActiveShiftRunGuidanceToProductionQueueRows(rows, []);
    assert.equal(rows[0].actionLabel, PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED);
    assert.equal(rows[0].productionWorkState, "READY_TO_START");
    assert.equal(rows[0].activeShiftRun, undefined);

    const actions = applyActiveShiftRunGuidanceToPendingActions(
      [
        {
          id: "production:wo:88:line:1",
          action: PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED,
          href: "/production?pwFocus=88",
        },
      ],
      [],
    );
    assert.equal(actions[0].action, PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED);
  });

  it("confirmed active Morning A past end is Record Production with overdue flag", () => {
    const guidance = mapActiveRunSegmentToGuidance(
      {
        id: 9,
        status: "ACTIVE",
        sessionId: 7,
        machineId: 3,
        runAllocationId: 55,
        workOrderId: 1001,
        segmentNo: 1,
        segmentStartedAt: new Date("2026-08-26T06:10:00+05:30"),
        session: {
          id: 7,
          status: "OPEN",
          sessionDate: "2026-08-26",
          shiftSessionNo: "SS-26-0004",
          machineId: 3,
          primaryOperatorId: 1,
          machine: { id: 3, machineCode: "INJ-01", machineName: "Injection 01" },
          shift: {
            id: 1,
            shiftCode: "A",
            shiftName: "Morning A",
            startTime: "06:00",
            endTime: "14:00",
          },
          primaryOperator: { id: 1, operatorName: "Ramesh Kumar", operatorCode: "OP-01" },
        },
        workOrder: { id: 1001, docNo: "WO-R-26-0001" },
        runAllocation: {
          id: 55,
          workOrderId: 1001,
          workOrderLineId: 200,
          startConfirmation: { id: 1, status: "CONFIRMED" },
          workOrder: { id: 1001, docNo: "WO-R-26-0001" },
        },
      },
      new Date("2026-08-27T07:00:00+05:30"),
    );
    assert.equal(guidance.primaryActionLabel, ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION);
    assert.equal(guidance.confirmationPending, false);
    assert.equal(guidance.shiftOverdue, true);
    assert.equal(guidance.shiftOverdueMessage, SHIFT_OVERDUE_MESSAGE);
    assert.match(guidance.workspaceHref, /focusRecordProduction=1/);
    assert.doesNotMatch(guidance.workspaceHref, /focusConfirmStart=1/);
  });

  it("HANDOVER_PENDING session is not treated as a live run", () => {
    const guidance = mapActiveRunSegmentToGuidance({
      id: 9,
      status: "ACTIVE",
      sessionId: 7,
      machineId: 3,
      runAllocationId: 55,
      workOrderId: 1001,
      segmentNo: 1,
      segmentStartedAt: new Date(),
      session: {
        id: 7,
        status: "HANDOVER_PENDING",
        shiftSessionNo: "SS-26-0004",
        machineId: 3,
        primaryOperatorId: 1,
        machine: { id: 3, machineCode: "INJ-01", machineName: "Injection 01" },
        shift: { id: 1, shiftCode: "A", shiftName: "Morning A" },
        primaryOperator: { id: 1, operatorName: "Ramesh Kumar", operatorCode: "OP-01" },
      },
      workOrder: { id: 1001, docNo: "WO-R-26-0001" },
      runAllocation: {
        id: 55,
        workOrderId: 1001,
        workOrderLineId: 200,
        startConfirmation: { id: 1, status: "CONFIRMED" },
        workOrder: { id: 1001, docNo: "WO-R-26-0001" },
      },
    });
    assert.equal(guidance, null);
  });

  it("shouldOverrideProductionActionLabel covers Ready-to-Start synonyms", () => {
    assert.equal(shouldOverrideProductionActionLabel("Ready to Start Production"), true);
    assert.equal(shouldOverrideProductionActionLabel("Continue Production"), true);
    assert.equal(shouldOverrideProductionActionLabel("QC Pending"), false);
  });
});
