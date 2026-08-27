/**
 * Shift grace / HANDOVER_PENDING Phase 1 — start, manager time, PE live gate, Shift Over.
 * In-memory mocks only. Does not touch live database erp.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  startShiftSession,
  requireOpenSession,
  completeShiftOver,
  SESSION_STATUS,
} = require("../../src/services/machineShiftSessionOperations");
const {
  endShiftForHandover,
  continueShiftOvertime,
  confirmShiftActualEnd,
} = require("../../src/services/shiftSessionManagerTimeService");
const { assertNormalLiveProductionEntryAllowed } = require("../../src/services/productionEntryLiveWindowService");
const { mapSessionDetail } = require("../../src/services/machineShiftSessionReadService");
const { assertShiftActionAllowed, SHIFT_ACTION } = require("../../src/services/machineShiftPermissions");
const { REPORT_VERSION_STATUS } = require("../../src/services/machineShiftProductionReportService");

function seq(start = 1) {
  let n = start;
  return () => {
    const v = n;
    n += 1;
    return v;
  };
}

function createDb(seed = {}) {
  const nextSessionId = seq(1);
  const nextOpPartId = seq(1);
  const nextSegId = seq(1);
  const machines = new Map([[1, { id: 1, isActive: true, machineCode: "M1", machineName: "Press 1" }]]);
  const shifts = new Map([
    [
      10,
      {
        id: 10,
        isActive: true,
        shiftCode: "A",
        shiftName: "Morning A",
        startTime: seed.startTime || "06:00",
        endTime: seed.endTime || "14:00",
      },
    ],
  ]);
  const operators = new Map([[100, { id: 100, isActive: true, operatorCode: "OP1", operatorName: "Alice" }]]);
  const sessions = [];
  const sessionOperators = [];
  const runSegments = seed.runSegments || [];
  const allocations = seed.allocations || [{ id: 200, workOrderId: 50, machineId: 1, isActive: true }];
  const appSetting = { id: 1, shiftGraceMinutes: seed.graceMinutes ?? 15 };
  const reports = [];
  const versions = [];

  const tx = {
    appSetting: {
      findUnique: async () => appSetting,
    },
    machine: {
      findUnique: async ({ where }) => machines.get(where.id) || null,
    },
    shift: {
      findUnique: async ({ where }) => shifts.get(where.id) || null,
    },
    operator: {
      findMany: async ({ where }) => (where?.id?.in || []).map((id) => operators.get(id)).filter(Boolean),
    },
    workOrderProductionRunAllocation: {
      findUnique: async ({ where }) => allocations.find((a) => a.id === where.id) || null,
      findMany: async ({ where } = {}) => {
        let rows = allocations.slice();
        if (where?.workOrderId != null) rows = rows.filter((a) => a.workOrderId === where.workOrderId);
        if (where?.isActive != null) rows = rows.filter((a) => a.isActive === where.isActive);
        if (where?.id?.in) rows = rows.filter((a) => where.id.in.includes(a.id));
        return rows;
      },
    },
    user: {
      count: async () => 1,
    },
    machineShiftSessionOperator: {
      findMany: async ({ where } = {}) => {
        let rows = sessionOperators.slice();
        if (where?.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where?.operatorId?.in) {
          const set = new Set(where.operatorId.in);
          rows = rows.filter((r) => set.has(r.operatorId));
        }
        if (where?.operatorId != null && !where?.operatorId?.in) {
          rows = rows.filter((r) => r.operatorId === where.operatorId);
        }
        if (where?.leftAt === null) rows = rows.filter((r) => r.leftAt == null);
        if (where?.sessionId?.not != null) rows = rows.filter((r) => r.sessionId !== where.sessionId.not);
        return rows;
      },
      create: async ({ data }) => {
        const row = { id: nextOpPartId(), ...data };
        sessionOperators.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = sessionOperators.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    machineShiftSessionRunSegment: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = runSegments.slice();
        if (where?.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        if (where?.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where?.status != null) rows = rows.filter((r) => r.status === where.status);
        if (where?.workOrderId != null) rows = rows.filter((r) => r.workOrderId === where.workOrderId);
        if (where?.runAllocationId != null) {
          if (where.runAllocationId.in) {
            rows = rows.filter((r) => where.runAllocationId.in.includes(r.runAllocationId));
          } else {
            rows = rows.filter((r) => r.runAllocationId === where.runAllocationId);
          }
        }
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows[0] || null;
      },
      findMany: async ({ where, orderBy } = {}) => {
        let rows = runSegments.slice();
        if (where?.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        if (where?.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where?.status != null) rows = rows.filter((r) => r.status === where.status);
        if (where?.workOrderId != null) rows = rows.filter((r) => r.workOrderId === where.workOrderId);
        if (where?.runAllocationId != null) {
          if (where.runAllocationId.in) {
            rows = rows.filter((r) => where.runAllocationId.in.includes(r.runAllocationId));
          } else {
            rows = rows.filter((r) => r.runAllocationId === where.runAllocationId);
          }
        }
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows;
      },
      findUnique: async ({ where }) => runSegments.find((r) => r.id === where.id) || null,
      update: async ({ where, data }) => {
        const row = runSegments.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    machineShiftDowntimeSegment: {
      findMany: async () => [],
    },
    shiftProductionReport: {
      findUnique: async ({ where }) => reports.find((r) => r.sessionId === where.sessionId) || null,
    },
    shiftProductionReportVersion: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = versions.slice();
        if (where?.reportId != null) rows = rows.filter((v) => v.reportId === where.reportId);
        if (where?.versionNo != null) rows = rows.filter((v) => v.versionNo === where.versionNo);
        if (orderBy?.versionNo === "desc") rows.sort((a, b) => b.versionNo - a.versionNo);
        return rows[0] ? { ...rows[0], lines: rows[0].lines || [] } : null;
      },
    },
    machineShiftSession: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = sessions.slice();
        if (where?.machineId != null) rows = rows.filter((s) => s.machineId === where.machineId);
        if (where?.status != null) rows = rows.filter((s) => s.status === where.status);
        if (where?.previousSessionId != null) {
          rows = rows.filter((s) => s.previousSessionId === where.previousSessionId);
        }
        if (where?.shiftSessionNo?.startsWith) {
          rows = rows.filter((s) => String(s.shiftSessionNo).startsWith(where.shiftSessionNo.startsWith));
        }
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        if (orderBy?.shiftSessionNo === "desc") {
          rows.sort((a, b) => String(b.shiftSessionNo).localeCompare(String(a.shiftSessionNo)));
        }
        return rows[0] || null;
      },
      findUnique: async ({ where }) => sessions.find((s) => s.id === where.id) || null,
      findMany: async ({ where } = {}) => {
        let rows = sessions.slice();
        if (where?.status != null) rows = rows.filter((s) => s.status === where.status);
        return rows;
      },
      updateMany: async ({ where, data }) => {
        let rows = sessions.slice();
        if (where?.id != null) rows = rows.filter((s) => s.id === where.id);
        if (where?.status != null) rows = rows.filter((s) => s.status === where.status);
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
      create: async ({ data, include }) => {
        if (data.status === "OPEN" && sessions.some((s) => s.machineId === data.machineId && s.status === "OPEN")) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          err.meta = { target: ["openMachId"] };
          throw err;
        }
        const { sessionOperators: opCreate, ...rest } = data;
        const id = nextSessionId();
        const row = {
          endedAt: null,
          endedByUserId: null,
          reopenCount: 0,
          ...rest,
          id,
        };
        sessions.push(row);
        const createdOps = [];
        for (const op of opCreate?.create || []) {
          const part = { id: nextOpPartId(), sessionId: id, ...op };
          sessionOperators.push(part);
          createdOps.push(part);
        }
        if (!include) return row;
        return {
          ...row,
          sessionOperators: createdOps,
          machine: machines.get(row.machineId),
          shift: shifts.get(row.shiftId) || null,
          primaryOperator: operators.get(row.primaryOperatorId),
        };
      },
      update: async ({ where, data }) => {
        const row = sessions.find((s) => s.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    _state: { sessions, sessionOperators, runSegments, reports, versions },
  };
  return tx;
}

const operators = [{ operatorId: 100, isPrimary: true }];

describe("startShiftSession — snapshots and windows", () => {
  it("requires explicit shiftId and never infers sessionDate", async () => {
    const db = createDb();
    await assert.rejects(
      () => startShiftSession({ machineId: 1, sessionDate: "2026-08-26", operators }, db),
      (e) => e.code === "SHIFT_ID_REQUIRED",
    );
  });

  it("snapshots scheduled times and grace from AppSetting", async () => {
    const db = createDb();
    const now = new Date("2026-08-26T06:00:00+05:30");
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "PRODUCTION",
        now,
      },
      db,
    );
    assert.equal(session.scheduledStartAt.toISOString(), "2026-08-26T00:30:00.000Z");
    assert.equal(session.scheduledEndAt.toISOString(), "2026-08-26T08:30:00.000Z");
    assert.equal(session.graceMinutesSnapshot, 15);
    assert.equal(session.startedOutsideWindow, false);
  });

  it("allows PRODUCTION start inside grace without outside-window reason", async () => {
    const db = createDb();
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "PRODUCTION",
        now: new Date("2026-08-26T06:10:00+05:30"),
      },
      db,
    );
    assert.equal(session.status, "OPEN");
    assert.equal(session.startedOutsideWindow, false);
  });

  it("rejects PRODUCTION outside the start window", async () => {
    const db = createDb();
    await assert.rejects(
      () =>
        startShiftSession(
          {
            machineId: 1,
            shiftId: 10,
            sessionDate: "2026-08-26",
            operators,
            actorRole: "PRODUCTION",
            now: new Date("2026-08-26T07:00:00+05:30"),
          },
          db,
        ),
      (e) => e.code === "SHIFT_START_OUTSIDE_WINDOW" && e.statusCode === 403,
    );
  });

  it("allows ADMIN outside window with an approved reason and remarks", async () => {
    const db = createDb();
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "ADMIN",
        startedOutsideWindowReason: "LATE_ARRIVAL",
        startedOutsideWindowRemarks: "Customer rush order",
        now: new Date("2026-08-26T07:00:00+05:30"),
      },
      db,
    );
    assert.equal(session.startedOutsideWindow, true);
    assert.equal(session.startedOutsideWindowReason, "LATE_ARRIVAL");
    assert.match(session.startedOutsideWindowRemarks, /rush/i);
  });

  it("accepts every approved outside-window reason and stores OTHER as OTHER", async () => {
    const reasons = [
      "EARLY_START",
      "LATE_ARRIVAL",
      "PREVIOUS_SHIFT_DELAY",
      "EMERGENCY",
      "OTHER",
    ];
    for (const reason of reasons) {
      const db = createDb();
      const session = await startShiftSession(
        {
          machineId: 1,
          shiftId: 10,
          sessionDate: "2026-08-26",
          operators,
          actorRole: "PRODUCTION_MANAGER",
          startedOutsideWindowReason: reason,
          startedOutsideWindowRemarks: `Manager override for ${reason}`,
          now: new Date("2026-08-26T07:00:00+05:30"),
        },
        db,
      );
      assert.equal(session.startedOutsideWindowReason, reason);
      assert.match(session.startedOutsideWindowRemarks, new RegExp(reason));
    }
  });

  it("rejects unknown outside-window reasons including LATE_START", async () => {
    const db = createDb();
    await assert.rejects(
      () =>
        startShiftSession(
          {
            machineId: 1,
            shiftId: 10,
            sessionDate: "2026-08-26",
            operators,
            actorRole: "ADMIN",
            startedOutsideWindowReason: "LATE_START",
            startedOutsideWindowRemarks: "old code",
            now: new Date("2026-08-26T07:00:00+05:30"),
          },
          db,
        ),
      (e) => e.code === "START_OUTSIDE_WINDOW_REASON_INVALID",
    );
    await assert.rejects(
      () =>
        startShiftSession(
          {
            machineId: 1,
            shiftId: 10,
            sessionDate: "2026-08-26",
            operators,
            actorRole: "ADMIN",
            startedOutsideWindowReason: "TRAFFIC",
            startedOutsideWindowRemarks: "traffic",
            now: new Date("2026-08-26T07:00:00+05:30"),
          },
          db,
        ),
      (e) => e.code === "START_OUTSIDE_WINDOW_REASON_INVALID",
    );
  });

  it("requires remarks for every outside-window start including OTHER", async () => {
    const db = createDb();
    await assert.rejects(
      () =>
        startShiftSession(
          {
            machineId: 1,
            shiftId: 10,
            sessionDate: "2026-08-26",
            operators,
            actorRole: "ADMIN",
            startedOutsideWindowReason: "OTHER",
            now: new Date("2026-08-26T07:00:00+05:30"),
          },
          db,
        ),
      (e) => e.code === "START_OUTSIDE_WINDOW_REMARKS_REQUIRED",
    );
  });

  it("rejects unresolved HANDOVER_PENDING on normal Start Shift", async () => {
    const db = createDb();
    db._state.sessions.push({
      id: 99,
      machineId: 1,
      status: "HANDOVER_PENDING",
      shiftSessionNo: "SS-26-0001",
      previousSessionId: null,
    });
    await assert.rejects(
      () =>
        startShiftSession(
          {
            machineId: 1,
            shiftId: 10,
            sessionDate: "2026-08-26",
            operators,
            actorRole: "ADMIN",
            now: new Date("2026-08-26T06:00:00+05:30"),
          },
          db,
        ),
      (e) => e.code === "SHIFT_HANDOVER_PENDING" && e.statusCode === 409,
    );
  });
});

describe("manager time controls", () => {
  it("PRODUCTION cannot use manager time controls even when no fallback is considered", async () => {
    const db = { user: { count: async () => 0 } };
    await assert.rejects(
      () => assertShiftActionAllowed(db, { role: "PRODUCTION" }, SHIFT_ACTION.MANAGER_TIME_CONTROLS),
      (e) => e.code === "PRODUCTION_MANAGER_ACTION_REQUIRED" && e.statusCode === 403,
    );
    await endShiftForHandover(
      {
        sessionId: 1,
        actualOperationalEndAt: new Date(),
        actorRole: "PRODUCTION",
        actorUserId: 7,
      },
      createDb(),
    ).then(
      () => {
        throw new Error("expected PRODUCTION to be rejected");
      },
      (e) => {
        assert.equal(e.code, "PRODUCTION_MANAGER_ACTION_REQUIRED");
      },
    );
  });

  it("End This Shift moves OPEN to HANDOVER_PENDING without closing the run", async () => {
    const db = createDb({
      runSegments: [{ id: 9, sessionId: 1, machineId: 1, status: "ACTIVE", workOrderId: 50, runAllocationId: 200 }],
    });
    const now = new Date("2026-08-26T13:50:00+05:30");
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "PRODUCTION_MANAGER",
        now: new Date("2026-08-26T06:00:00+05:30"),
      },
      db,
    );
    db._state.runSegments[0].sessionId = session.id;
    const actualEnd = new Date("2026-08-26T13:45:00+05:30");
    const result = await endShiftForHandover(
      {
        sessionId: session.id,
        actualOperationalEndAt: actualEnd,
        actorRole: "PRODUCTION_MANAGER",
        actorUserId: 8,
        now,
      },
      db,
    );
    assert.equal(result.session.status, "HANDOVER_PENDING");
    assert.equal(result.session.liveProductionStoppedAt.toISOString(), now.toISOString());
    assert.equal(result.session.actualOperationalEndAt.toISOString(), actualEnd.toISOString());
    assert.equal(db._state.runSegments[0].status, "ACTIVE");
  });

  it("rejects actual end in the future or after the authorized cutoff", async () => {
    const db = createDb();
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "ADMIN",
        now: new Date("2026-08-26T06:00:00+05:30"),
      },
      db,
    );
    await assert.rejects(
      () =>
        endShiftForHandover(
          {
            sessionId: session.id,
            actualOperationalEndAt: new Date("2026-08-26T15:00:00+05:30"),
            actorRole: "ADMIN",
            now: new Date("2026-08-26T13:00:00+05:30"),
          },
          db,
        ),
      (e) => e.code === "ACTUAL_END_INVALID",
    );
  });

  it("Continue Overtime stays OPEN and extends live cutoff", async () => {
    const db = createDb();
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "ADMIN",
        now: new Date("2026-08-26T06:00:00+05:30"),
      },
      db,
    );
    const until = new Date("2026-08-26T16:00:00+05:30");
    const result = await continueShiftOvertime(
      {
        sessionId: session.id,
        approvedUntil: until,
        reason: "Die change overran",
        actorRole: "ADMIN",
        actorUserId: 8,
        now: new Date("2026-08-26T14:00:00+05:30"),
      },
      db,
    );
    assert.equal(result.session.status, "OPEN");
    assert.equal(result.session.overtimeApprovedUntil.toISOString(), until.toISOString());
    assert.equal(result.session.overtimeApprovedByUserId, 8);
    assert.match(result.session.overtimeReason, /Die change/);
  });

  it("overtime then past approvedUntil expires to HANDOVER_PENDING", async () => {
    const db = createDb();
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "ADMIN",
        now: new Date("2026-08-26T06:00:00+05:30"),
      },
      db,
    );
    await continueShiftOvertime(
      {
        sessionId: session.id,
        approvedUntil: new Date("2026-08-26T16:00:00+05:30"),
        reason: "Finish remaining shots",
        actorRole: "ADMIN",
        actorUserId: 8,
        now: new Date("2026-08-26T14:10:00+05:30"),
      },
      db,
    );
    await assert.rejects(
      () => requireOpenSession(db, session.id, new Date("2026-08-26T16:00:01+05:30")),
      (e) => e.code === "SHIFT_SESSION_NOT_OPEN",
    );
    const row = db._state.sessions.find((s) => s.id === session.id);
    assert.equal(row.status, "HANDOVER_PENDING");
    assert.equal(row.liveProductionStoppedAt.toISOString(), "2026-08-26T10:30:00.000Z");
  });

  it("Confirm Actual End is HANDOVER_PENDING only and does not copy detection time", async () => {
    const db = createDb();
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "ADMIN",
        now: new Date("2026-08-26T06:00:00+05:30"),
      },
      db,
    );
    await requireOpenSession(db, session.id, new Date("2026-08-26T14:20:00+05:30")).then(
      () => {
        throw new Error("expected expiry");
      },
      (e) => {
        assert.equal(e.code, "SHIFT_SESSION_NOT_OPEN");
      },
    );
    const row = db._state.sessions.find((s) => s.id === session.id);
    const detected = row.timeEndDetectedAt;
    const actual = new Date("2026-08-26T14:10:00+05:30");
    const result = await confirmShiftActualEnd(
      {
        sessionId: session.id,
        actualOperationalEndAt: actual,
        actorRole: "PRODUCTION_MANAGER",
        actorUserId: 8,
        now: new Date("2026-08-26T14:30:00+05:30"),
      },
      db,
    );
    assert.equal(result.session.actualOperationalEndAt.toISOString(), actual.toISOString());
    assert.notEqual(result.session.actualOperationalEndAt.toISOString(), detected.toISOString());
    assert.equal(result.session.timeEndDetectedAt.toISOString(), detected.toISOString());
  });
});

describe("live Production Entry gate", () => {
  it("blocks normal PE after live cutoff with SHIFT_LIVE_WINDOW_ENDED", async () => {
    const db = createDb({
      runSegments: [{ id: 9, sessionId: 1, machineId: 1, status: "ACTIVE", workOrderId: 50, runAllocationId: 200 }],
    });
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "ADMIN",
        now: new Date("2026-08-26T06:00:00+05:30"),
      },
      db,
    );
    db._state.runSegments[0].sessionId = session.id;
    await assert.rejects(
      () =>
        assertNormalLiveProductionEntryAllowed(db, {
          workOrderId: 50,
          runAllocationId: 200,
          now: new Date("2026-08-26T14:20:00+05:30"),
        }),
      (e) =>
        e.code === "SHIFT_LIVE_WINDOW_ENDED" &&
        e.details?.nextAction === "MANAGER_HANDOVER_OR_LATE_ENTRY",
    );
  });

  it("allows PE while OPEN, ACTIVE, and within live cutoff", async () => {
    const db = createDb({
      runSegments: [{ id: 9, sessionId: 1, machineId: 1, status: "ACTIVE", workOrderId: 50, runAllocationId: 200 }],
    });
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "ADMIN",
        now: new Date("2026-08-26T06:00:00+05:30"),
      },
      db,
    );
    db._state.runSegments[0].sessionId = session.id;
    const ok = await assertNormalLiveProductionEntryAllowed(db, {
      workOrderId: 50,
      runAllocationId: 200,
      now: new Date("2026-08-26T13:00:00+05:30"),
    });
    assert.equal(ok.skipped, false);
    assert.equal(ok.session.id, session.id);
  });

  it("skips the live-window gate when the server proves no shift-linked run", async () => {
    const db = createDb();
    const result = await assertNormalLiveProductionEntryAllowed(db, {
      workOrderId: 50,
      runAllocationId: 200,
      now: new Date("2026-08-26T13:00:00+05:30"),
    });
    assert.equal(result.skipped, true);

    const omitted = await assertNormalLiveProductionEntryAllowed(db, {
      workOrderId: 99,
      now: new Date("2026-08-26T13:00:00+05:30"),
    });
    assert.equal(omitted.skipped, true);
  });

  it("omitted runAllocationId still blocks OPEN past cutoff and HANDOVER_PENDING", async () => {
    const db = createDb({
      runSegments: [{ id: 9, sessionId: 1, machineId: 1, status: "ACTIVE", workOrderId: 50, runAllocationId: 200 }],
    });
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "ADMIN",
        now: new Date("2026-08-26T06:00:00+05:30"),
      },
      db,
    );
    db._state.runSegments[0].sessionId = session.id;
    await assert.rejects(
      () =>
        assertNormalLiveProductionEntryAllowed(db, {
          workOrderId: 50,
          now: new Date("2026-08-26T14:20:00+05:30"),
        }),
      (e) => e.code === "SHIFT_LIVE_WINDOW_ENDED",
    );
  });
});

describe("Shift Over from HANDOVER_PENDING", () => {
  it("still requires a verified report", async () => {
    const db = createDb();
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "ADMIN",
        now: new Date("2026-08-26T06:00:00+05:30"),
      },
      db,
    );
    db._state.sessions.find((s) => s.id === session.id).status = "HANDOVER_PENDING";
    db._state.reports.push({ id: 1, sessionId: session.id, latestVersionNo: 1 });
    db._state.versions.push({
      id: 1,
      reportId: 1,
      versionNo: 1,
      status: REPORT_VERSION_STATUS.DRAFT,
    });
    await assert.rejects(
      () => completeShiftOver({ sessionId: session.id, handoverState: "CLEARED", actorUserId: 7 }, db),
      (e) => e.code === "SHIFT_OVER_REQUIRES_VERIFIED_REPORT",
    );
  });

  it("allows Shift Over from HANDOVER_PENDING after the report is verified", async () => {
    const db = createDb();
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-26",
        operators,
        actorRole: "ADMIN",
        now: new Date("2026-08-26T06:00:00+05:30"),
      },
      db,
    );
    const row = db._state.sessions.find((s) => s.id === session.id);
    row.status = "HANDOVER_PENDING";
    db._state.reports.push({ id: 1, sessionId: session.id, latestVersionNo: 1 });
    db._state.versions.push({
      id: 1,
      reportId: 1,
      versionNo: 1,
      status: REPORT_VERSION_STATUS.VERIFIED,
    });
    const result = await completeShiftOver(
      { sessionId: session.id, handoverState: "CLEARED", actorUserId: 7 },
      db,
    );
    assert.equal(result.completed, true);
    assert.equal(result.session.status, SESSION_STATUS.SHIFT_OVER);
  });
});

describe("session DTO time window fields", () => {
  it("exposes scheduled times, live cutoff, and handover guidance", () => {
    const dto = mapSessionDetail({
      id: 1,
      shiftSessionNo: "SS-26-0099",
      status: "HANDOVER_PENDING",
      sessionDate: "2026-08-26",
      machine: { id: 1, machineCode: "M1", machineName: "Press 1" },
      shift: { id: 10, shiftCode: "A", shiftName: "Morning A", startTime: "06:00", endTime: "14:00" },
      primaryOperator: { id: 100, operatorCode: "OP1", operatorName: "Alice" },
      scheduledStartAt: new Date("2026-08-26T00:30:00.000Z"),
      scheduledEndAt: new Date("2026-08-26T08:30:00.000Z"),
      graceMinutesSnapshot: 15,
      liveProductionStoppedAt: new Date("2026-08-26T08:45:00.000Z"),
      timeEndDetectedAt: new Date("2026-08-26T09:10:00.000Z"),
      actualOperationalEndAt: null,
      startedAt: new Date("2026-08-26T00:30:00.000Z"),
      sessionOperators: [],
      runSegments: [],
      downtimeSegments: [],
      shiftReport: null,
      reopenRequests: [],
    });
    assert.equal(dto.scheduledStartAt, "2026-08-26T00:30:00.000Z");
    assert.equal(dto.liveCutoffAt, "2026-08-26T08:45:00.000Z");
    assert.equal(dto.actualEndConfirmationPending, true);
    assert.equal(dto.statusGuidanceCode, "HANDOVER_PENDING_CONFIRM_ACTUAL_END");
    assert.equal(dto.status, "HANDOVER_PENDING");
    assert.equal(dto.isLiveProductionAllowed, false);
    assert.match(dto.statusGuidance, /handover needed/i);
  });

  it("does not label HANDOVER_PENDING as a live OPEN session", () => {
    const dto = mapSessionDetail({
      id: 1,
      shiftSessionNo: "SS-26-0099",
      status: "HANDOVER_PENDING",
      sessionDate: "2026-08-26",
      machine: { id: 1, machineCode: "M1", machineName: "Press 1" },
      shift: { id: 10, shiftCode: "A", shiftName: "Morning A", startTime: "06:00", endTime: "14:00" },
      primaryOperator: { id: 100, operatorCode: "OP1", operatorName: "Alice" },
      scheduledStartAt: new Date("2026-08-26T00:30:00.000Z"),
      scheduledEndAt: new Date("2026-08-26T08:30:00.000Z"),
      graceMinutesSnapshot: 15,
      liveProductionStoppedAt: new Date("2026-08-26T08:45:00.000Z"),
      actualOperationalEndAt: null,
      startedAt: new Date("2026-08-26T00:30:00.000Z"),
      sessionOperators: [],
      runSegments: [
        {
          id: 9,
          segmentNo: 1,
          status: "ACTIVE",
          workOrderId: 50,
          runAllocationId: 200,
          segmentStartedAt: new Date("2026-08-26T00:40:00.000Z"),
          runAllocation: {
            id: 200,
            workOrderId: 50,
            workOrderLineId: 10,
            startConfirmation: { id: 1, status: "CONFIRMED" },
          },
        },
      ],
      downtimeSegments: [],
      shiftReport: null,
      reopenRequests: [],
    });
    assert.equal(dto.status, "HANDOVER_PENDING");
    assert.notEqual(dto.status, "OPEN");
    assert.equal(dto.isLiveProductionAllowed, false);
    assert.equal(dto.runSegments[0].primaryActionLabel, null);
  });
});
