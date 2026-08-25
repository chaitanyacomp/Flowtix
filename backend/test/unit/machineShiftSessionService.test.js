/**
 * Step 2A — Machine Shift Session core services (unit tests with in-memory tx).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  startShiftSession,
  joinSessionOperator,
  leaveSessionOperator,
  changePrimaryOperator,
  startRunSegment,
  closeRunSegment,
  pauseForDowntime,
  resumeFromDowntime,
  continueDowntimeIntoSession,
  durationMinutesFromTimestamps,
  allocateShiftSessionNo,
  mapShiftSessionPersistenceError,
  normalizeSessionDate,
  SYSTEM_CLOSE_REASON,
  listBusyOperatorsAcrossOpenSessions,
} = require("../../src/services/machineShiftSessionOperations");

function seq(start = 1) {
  let n = start;
  return () => {
    const v = n;
    n += 1;
    return v;
  };
}

function createMemoryDb(seed = {}) {
  const nextSessionId = seq(seed.sessionIdStart || 1);
  const nextOpPartId = seq(1);
  const nextSegId = seq(1);
  const nextIncidentId = seq(1);
  const nextDtSegId = seq(1);

  const machines = new Map(
    (
      seed.machines || [
        { id: 1, isActive: true, machineCode: "M1", machineName: "Press 1" },
        { id: 2, isActive: true, machineCode: "M2", machineName: "Press 2" },
      ]
    ).map((m) => [m.id, m]),
  );
  const shifts = new Map((seed.shifts || [{ id: 10, isActive: true, shiftCode: "NIGHT", shiftName: "Night" }]).map((s) => [s.id, s]));
  const operators = new Map(
    (
      seed.operators || [
        { id: 100, isActive: true, operatorCode: "OP1", operatorName: "Alice" },
        { id: 101, isActive: true, operatorCode: "OP2", operatorName: "Bob" },
        { id: 102, isActive: true, operatorCode: "OP3", operatorName: "Cara" },
      ]
    ).map((o) => [o.id, o]),
  );
  const workOrders = new Map(
    (seed.workOrders || [{ id: 50, status: "IN_PROGRESS", docNo: "WO-R-26-0001" }]).map((w) => [w.id, w]),
  );
  const runAllocations = new Map(
    (
      seed.runAllocations || [
        { id: 200, workOrderId: 50, machineId: 1, isActive: true, runSequence: 1 },
        { id: 201, workOrderId: 50, machineId: 2, isActive: true, runSequence: 1 },
      ]
    ).map((r) => [r.id, r]),
  );

  function throwActiveOpConflict() {
    const err = new Error("Unique constraint failed");
    err.code = "P2002";
    err.meta = { target: ["activeOpId"] };
    throw err;
  }

  function assertActiveOpAvailable(operatorId, leftAt) {
    if (leftAt != null) return;
    if (sessionOperators.some((r) => r.operatorId === operatorId && r.leftAt == null)) {
      throwActiveOpConflict();
    }
  }

  function filterSessionOperators(where = {}) {
    let rows = sessionOperators.slice();
    if (where.sessionId != null) {
      if (where.sessionId.not != null) {
        rows = rows.filter((r) => r.sessionId !== where.sessionId.not);
      } else {
        rows = rows.filter((r) => r.sessionId === where.sessionId);
      }
    }
    if (where.operatorId?.in) {
      const set = new Set(where.operatorId.in);
      rows = rows.filter((r) => set.has(r.operatorId));
    } else if (where.operatorId != null) {
      rows = rows.filter((r) => r.operatorId === where.operatorId);
    }
    if (where.leftAt === null) rows = rows.filter((r) => r.leftAt == null);
    if (where.leftAt?.not != null) rows = rows.filter((r) => r.leftAt != null);
    if (where.joinedLeaveReason != null) {
      rows = rows.filter((r) => r.joinedLeaveReason === where.joinedLeaveReason);
    }
    return rows;
  }

  function enrichOperatorRow(row, include) {
    if (!include) return row;
    const out = { ...row };
    if (include.session) {
      const session = sessions.find((s) => s.id === row.sessionId);
      out.session = session
        ? {
            id: session.id,
            shiftSessionNo: session.shiftSessionNo,
            status: session.status,
            machineId: session.machineId,
            machine: machines.get(session.machineId) || null,
          }
        : null;
    }
    if (include.operator) {
      out.operator = operators.get(row.operatorId) || null;
    }
    return out;
  }

  const sessions = [];
  const sessionOperators = [];
  const runSegments = [];
  const downtimeIncidents = [];
  const downtimeSegments = [];

  const tx = {
    machine: {
      findUnique: async ({ where }) => machines.get(where.id) || null,
    },
    shift: {
      findUnique: async ({ where }) => shifts.get(where.id) || null,
    },
    operator: {
      findMany: async ({ where }) => {
        const ids = where?.id?.in || [];
        return ids.map((id) => operators.get(id)).filter(Boolean);
      },
    },
    workOrder: {
      findUnique: async ({ where }) => workOrders.get(where.id) || null,
    },
    workOrderProductionRunAllocation: {
      findUnique: async ({ where }) => runAllocations.get(where.id) || null,
    },
    machineShiftSession: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = sessions.slice();
        if (where?.machineId != null) rows = rows.filter((s) => s.machineId === where.machineId);
        if (where?.status != null) rows = rows.filter((s) => s.status === where.status);
        if (where?.shiftSessionNo?.startsWith) {
          const p = where.shiftSessionNo.startsWith;
          rows = rows.filter((s) => String(s.shiftSessionNo).startsWith(p));
        }
        if (orderBy?.shiftSessionNo === "desc") {
          rows.sort((a, b) => String(b.shiftSessionNo).localeCompare(String(a.shiftSessionNo)));
        } else if (orderBy?.id === "desc") {
          rows.sort((a, b) => b.id - a.id);
        }
        return rows[0] || null;
      },
      findUnique: async ({ where }) => sessions.find((s) => s.id === where.id) || null,
      create: async ({ data, include }) => {
        // Simulate MySQL uq_mss_open
        if (data.status === "OPEN" && sessions.some((s) => s.machineId === data.machineId && s.status === "OPEN")) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          err.meta = { target: ["openMachId"] };
          throw err;
        }
        if (sessions.some((s) => s.shiftSessionNo === data.shiftSessionNo)) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          err.meta = { target: ["shiftSessionNo"] };
          throw err;
        }
        const id = nextSessionId();
        const row = {
          id,
          machineId: data.machineId,
          shiftId: data.shiftId ?? null,
          sessionDate: data.sessionDate,
          shiftSessionNo: data.shiftSessionNo,
          status: data.status,
          handoverState: data.handoverState,
          primaryOperatorId: data.primaryOperatorId,
          startedAt: data.startedAt,
          startedByUserId: data.startedByUserId ?? null,
          endedAt: null,
          endedByUserId: null,
          reopenCount: 0,
        };
        sessions.push(row);
        const createdOps = [];
        for (const op of data.sessionOperators?.create || []) {
          assertActiveOpAvailable(op.operatorId, op.leftAt ?? null);
          const part = {
            id: nextOpPartId(),
            sessionId: id,
            ...op,
          };
          sessionOperators.push(part);
          createdOps.push(part);
        }
        if (!include) return row;
        return {
          ...row,
          sessionOperators: createdOps,
          machine: machines.get(row.machineId),
          shift: row.shiftId != null ? shifts.get(row.shiftId) : null,
          primaryOperator: operators.get(row.primaryOperatorId),
        };
      },
      update: async ({ where, data }) => {
        const row = sessions.find((s) => s.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    machineShiftSessionOperator: {
      findMany: async ({ where, orderBy, include } = {}) => {
        let rows = filterSessionOperators(where);
        if (orderBy?.id === "desc") rows = rows.slice().sort((a, b) => b.id - a.id);
        else if (orderBy?.operatorId === "asc" || orderBy?.[0]?.operatorId === "asc") {
          rows = rows.slice().sort((a, b) => a.operatorId - b.operatorId || a.id - b.id);
        } else if (orderBy) rows = rows.slice().sort((a, b) => a.id - b.id);
        return rows.map((r) => enrichOperatorRow(r, include));
      },
      findFirst: async ({ where, orderBy, include } = {}) => {
        let rows = filterSessionOperators(where);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        if (orderBy?.leftAt === "desc") rows.sort((a, b) => (b.leftAt?.getTime?.() || 0) - (a.leftAt?.getTime?.() || 0));
        const row = rows[0] || null;
        return row ? enrichOperatorRow(row, include) : null;
      },
      create: async ({ data }) => {
        assertActiveOpAvailable(data.operatorId, data.leftAt ?? null);
        const row = { id: nextOpPartId(), ...data };
        sessionOperators.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = sessionOperators.find((r) => r.id === where.id);
        const nextLeftAt = data.leftAt !== undefined ? data.leftAt : row.leftAt;
        if (row.leftAt != null && nextLeftAt == null) {
          assertActiveOpAvailable(row.operatorId, null);
        }
        Object.assign(row, data);
        return row;
      },
    },
    machineShiftSessionRunSegment: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = runSegments.slice();
        if (where.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        if (where.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where.status != null) rows = rows.filter((r) => r.status === where.status);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows[0] || null;
      },
      findUnique: async ({ where }) => runSegments.find((r) => r.id === where.id) || null,
      count: async ({ where }) => runSegments.filter((r) => r.sessionId === where.sessionId).length,
      create: async ({ data }) => {
        if (data.status === "ACTIVE" && runSegments.some((r) => r.machineId === data.machineId && r.status === "ACTIVE")) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          err.meta = { target: ["actMachId"] };
          throw err;
        }
        const row = { id: nextSegId(), closedAt: null, closedByUserId: null, closeReason: null, ...data };
        runSegments.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = runSegments.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    // Qty-lock reads (no report ⇒ unlocked) — required after production-qty lock gate on run start.
    shiftProductionReport: {
      findUnique: async () => null,
    },
    shiftProductionReportVersion: {
      findFirst: async () => null,
    },
    machineShiftDowntimeIncident: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = downtimeIncidents.slice();
        if (where.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        if (where.endedAt === null) rows = rows.filter((r) => r.endedAt == null);
        if (where.endedAt?.not != null) rows = rows.filter((r) => r.endedAt != null);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        if (orderBy?.endedAt === "desc") {
          rows.sort((a, b) => (b.endedAt?.getTime?.() || 0) - (a.endedAt?.getTime?.() || 0));
        }
        return rows[0] || null;
      },
      findUnique: async ({ where }) => downtimeIncidents.find((r) => r.id === where.id) || null,
      create: async ({ data }) => {
        const row = { id: nextIncidentId(), ...data };
        downtimeIncidents.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = downtimeIncidents.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    machineShiftDowntimeSegment: {
      findFirst: async ({ where, include, orderBy } = {}) => {
        let rows = downtimeSegments.slice();
        if (where.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where.incidentId != null) rows = rows.filter((r) => r.incidentId === where.incidentId);
        if (where.segmentEndAt === null) rows = rows.filter((r) => r.segmentEndAt == null);
        if (where.incident?.machineId != null) {
          rows = rows.filter((r) => {
            const inc = downtimeIncidents.find((i) => i.id === r.incidentId);
            return inc && inc.machineId === where.incident.machineId;
          });
        }
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        const row = rows[0] || null;
        if (!row) return null;
        if (include?.incident) {
          return { ...row, incident: downtimeIncidents.find((i) => i.id === row.incidentId) };
        }
        return row;
      },
      findMany: async ({ where } = {}) => {
        let rows = downtimeSegments.slice();
        if (where.incidentId != null) rows = rows.filter((r) => r.incidentId === where.incidentId);
        if (where.segmentEndAt === null) rows = rows.filter((r) => r.segmentEndAt == null);
        if (where.sessionId?.not != null) rows = rows.filter((r) => r.sessionId !== where.sessionId.not);
        return rows;
      },
      create: async ({ data }) => {
        if (
          downtimeSegments.some(
            (r) => r.incidentId === data.incidentId && r.sessionId === data.sessionId,
          )
        ) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          err.meta = { target: ["incidentId", "sessionId"] };
          throw err;
        }
        const openOnMachine = downtimeSegments.find((r) => {
          if (r.segmentEndAt != null) return false;
          const inc = downtimeIncidents.find((i) => i.id === r.incidentId);
          const newInc = downtimeIncidents.find((i) => i.id === data.incidentId);
          return inc && newInc && inc.machineId === newInc.machineId;
        });
        // App layer prevents this; DB may not — keep simple.
        void openOnMachine;
        const row = { id: nextDtSegId(), ...data };
        downtimeSegments.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = downtimeSegments.find((r) => r.id === where.id);
        const beforeStart = row.segmentStartAt;
        Object.assign(row, data);
        // Guard test helper: never allow start rewrite in tests accidentally
        if (data.segmentStartAt != null && data.segmentStartAt !== beforeStart) {
          throw new Error("Must not rewrite previous downtime segment start");
        }
        return row;
      },
    },
    _state: {
      sessions,
      sessionOperators,
      runSegments,
      downtimeIncidents,
      downtimeSegments,
      machines,
      operators,
      workOrders,
      runAllocations,
    },
  };

  return tx;
}

describe("normalizeSessionDate / numbering", () => {
  it("keeps YYYY-MM-DD as calendar starting date (night shift)", () => {
    const d = normalizeSessionDate("2026-08-24");
    assert.equal(d.toISOString().slice(0, 10), "2026-08-24");
  });

  it("allocates SS-YY-#### sequentially", async () => {
    const db = createMemoryDb();
    const no1 = await allocateShiftSessionNo(db, { date: new Date("2026-08-24T12:00:00Z") });
    assert.match(no1, /^SS-26-\d{4}$/);
    db._state.sessions.push({
      id: 99,
      machineId: 9,
      status: "SHIFT_OVER",
      shiftSessionNo: no1,
    });
    const no2 = await allocateShiftSessionNo(db, { date: new Date("2026-08-24T12:00:00Z") });
    assert.notEqual(no2, no1);
  });
});

describe("startShiftSession", () => {
  it("starts session with operators and primary", async () => {
    const db = createMemoryDb();
    const session = await startShiftSession(
      {
        machineId: 1,
        shiftId: 10,
        sessionDate: "2026-08-24",
        startedByUserId: 7,
        operators: [
          { operatorId: 100, isPrimary: true },
          { operatorId: 101, isPrimary: false },
        ],
        handoverState: "RETAINED",
      },
      db,
    );
    assert.equal(session.status, "OPEN");
    assert.equal(session.primaryOperatorId, 100);
    assert.equal(session.startedByUserId, 7);
    assert.match(session.shiftSessionNo, /^SS-26-/);
    assert.equal(session.sessionOperators.length, 2);
    assert.equal(session.sessionOperators.filter((o) => o.isPrimarySnapshot).length, 1);
  });

  it("rejects zero / multiple primaries and inactive machine", async () => {
    const db = createMemoryDb();
    await assert.rejects(
      () =>
        startShiftSession(
          {
            machineId: 1,
            sessionDate: "2026-08-24",
            operators: [{ operatorId: 100, isPrimary: false }],
          },
          db,
        ),
      /primary/i,
    );
    db._state.machines.get(1).isActive = false;
    await assert.rejects(
      () =>
        startShiftSession(
          {
            machineId: 1,
            sessionDate: "2026-08-24",
            operators: [{ operatorId: 100, isPrimary: true }],
          },
          db,
        ),
      /inactive/i,
    );
  });

  it("conflicts when machine already has open session", async () => {
    const db = createMemoryDb();
    await startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 100, isPrimary: true }],
      },
      db,
    );
    await assert.rejects(
      () =>
        startShiftSession(
          {
            machineId: 1,
            sessionDate: "2026-08-25",
            operators: [{ operatorId: 101, isPrimary: true }],
          },
          db,
        ),
      (e) => e.code === "SHIFT_SESSION_ALREADY_OPEN" && e.statusCode === 409,
    );
  });
});

describe("operator management", () => {
  async function openSession(db) {
    return startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [
          { operatorId: 100, isPrimary: true },
          { operatorId: 101, isPrimary: false },
        ],
        startedByUserId: 1,
      },
      db,
    );
  }

  it("joins and leaves with history preserved; blocks primary leave", async () => {
    const db = createMemoryDb();
    const session = await openSession(db);

    const join = await joinSessionOperator(
      { sessionId: session.id, operatorId: 102, changeReason: "Relief join", actorUserId: 1 },
      db,
    );
    assert.equal(join.created, true);

    const joinAgain = await joinSessionOperator(
      { sessionId: session.id, operatorId: 102, changeReason: "retry", actorUserId: 1 },
      db,
    );
    assert.equal(joinAgain.created, false);

    await assert.rejects(
      () =>
        leaveSessionOperator(
          { sessionId: session.id, operatorId: 100, changeReason: "leaving", actorUserId: 1 },
          db,
        ),
      /primary/i,
    );

    const left = await leaveSessionOperator(
      { sessionId: session.id, operatorId: 101, changeReason: "End of duty", actorUserId: 1 },
      db,
    );
    assert.equal(left.left, true);
    assert.ok(left.participation.leftAt);

    const history = db._state.sessionOperators.filter((r) => r.operatorId === 101);
    assert.equal(history.length, 1);
    assert.ok(history[0].joinedAt);
    assert.ok(history[0].leftAt);
  });

  it("changes primary without multiple actives and keeps prior as secondary", async () => {
    const db = createMemoryDb();
    const session = await openSession(db);
    const beforeCount = db._state.sessionOperators.length;

    const result = await changePrimaryOperator(
      {
        sessionId: session.id,
        newPrimaryOperatorId: 101,
        changeReason: "Handover",
        actorUserId: 1,
      },
      db,
    );
    assert.equal(result.changed, true);
    assert.equal(result.primaryOperatorId, 101);
    assert.ok(db._state.sessionOperators.length > beforeCount);

    const actives = db._state.sessionOperators.filter((r) => r.leftAt == null);
    assert.equal(actives.filter((r) => r.isPrimarySnapshot).length, 1);
    assert.ok(actives.some((r) => r.operatorId === 100 && !r.isPrimarySnapshot));
    assert.ok(actives.some((r) => r.operatorId === 101 && r.isPrimarySnapshot));

    const idem = await changePrimaryOperator(
      {
        sessionId: session.id,
        newPrimaryOperatorId: 101,
        changeReason: "retry",
        actorUserId: 1,
      },
      db,
    );
    assert.equal(idem.changed, false);
  });

  it("rejects start when operator is already active on another machine", async () => {
    const db = createMemoryDb();
    await startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 100, isPrimary: true }],
      },
      db,
    );
    await assert.rejects(
      () =>
        startShiftSession(
          {
            machineId: 2,
            sessionDate: "2026-08-24",
            operators: [{ operatorId: 100, isPrimary: true }],
          },
          db,
        ),
      (e) => e.code === "OPERATOR_ACTIVE_ON_ANOTHER_MACHINE" && e.statusCode === 409,
    );
  });

  it("rejects join when operator is already active on another machine", async () => {
    const db = createMemoryDb();
    const a = await startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 100, isPrimary: true }],
      },
      db,
    );
    const b = await startShiftSession(
      {
        machineId: 2,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 101, isPrimary: true }],
      },
      db,
    );
    await assert.rejects(
      () =>
        joinSessionOperator(
          { sessionId: b.id, operatorId: 100, changeReason: "cross join", actorUserId: 1 },
          db,
        ),
      (e) =>
        e.code === "OPERATOR_ACTIVE_ON_ANOTHER_MACHINE" &&
        e.statusCode === 409 &&
        /Press 1/i.test(e.message) &&
        e.details?.machineCode === "M1",
    );
    const busy = await listBusyOperatorsAcrossOpenSessions(db);
    assert.ok(busy.some((r) => r.operatorId === 100 && r.sessionId === a.id));
    assert.ok(busy.some((r) => r.operatorId === 101 && r.sessionId === b.id));
  });

  it("maps concurrent activeOpId unique conflict to OPERATOR_ACTIVE_ON_ANOTHER_MACHINE", async () => {
    const db = createMemoryDb();
    await startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 100, isPrimary: true }],
      },
      db,
    );
    const b = await startShiftSession(
      {
        machineId: 2,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 101, isPrimary: true }],
      },
      db,
    );
    // Simulate race: assert passed elsewhere, create hits uq_mssop_active_op
    await assert.rejects(
      () =>
        db.machineShiftSessionOperator.create({
          data: {
            sessionId: b.id,
            operatorId: 100,
            isPrimarySnapshot: false,
            joinedAt: new Date(),
            leftAt: null,
            joinedLeaveReason: "race",
          },
        }),
      (e) => e.code === "P2002" && /activeOpId/i.test(String(e.meta?.target)),
    );
    const mapped = mapShiftSessionPersistenceError(
      { code: "P2002", meta: { target: ["activeOpId"] } },
      { action: "startSession" },
    );
    assert.equal(mapped.code, "OPERATOR_ACTIVE_ON_ANOTHER_MACHINE");
    assert.equal(mapped.statusCode, 409);
  });

  it("allows leave then join another machine", async () => {
    const db = createMemoryDb();
    const a = await startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [
          { operatorId: 100, isPrimary: true },
          { operatorId: 101, isPrimary: false },
        ],
      },
      db,
    );
    const b = await startShiftSession(
      {
        machineId: 2,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 102, isPrimary: true }],
      },
      db,
    );

    await leaveSessionOperator(
      { sessionId: a.id, operatorId: 101, changeReason: "Moving to Press 2", actorUserId: 1 },
      db,
    );
    const joined = await joinSessionOperator(
      { sessionId: b.id, operatorId: 101, changeReason: "Relief on Press 2", actorUserId: 1 },
      db,
    );
    assert.equal(joined.created, true);
    assert.equal(joined.participation.sessionId, b.id);
    assert.equal(joined.participation.leftAt, null);

    const historyA = db._state.sessionOperators.filter((r) => r.sessionId === a.id && r.operatorId === 101);
    assert.equal(historyA.length, 1);
    assert.ok(historyA[0].leftAt);
  });
});

describe("run segments", () => {
  async function ready(db) {
    return startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 100, isPrimary: true }],
      },
      db,
    );
  }

  it("starts and closes a run segment; only one ACTIVE; no ProductionEntry side effects", async () => {
    const db = createMemoryDb();
    const session = await ready(db);
    const started = await startRunSegment(
      { sessionId: session.id, runAllocationId: 200, actorUserId: 1 },
      db,
    );
    assert.equal(started.created, true);
    assert.equal(started.segment.status, "ACTIVE");
    assert.equal(started.segment.machineId, 1);
    assert.equal(started.segment.workOrderId, 50);

    await assert.rejects(
      () => startRunSegment({ sessionId: session.id, workOrderId: 50, actorUserId: 1 }, db),
      (e) => e.code === "ACTIVE_RUN_SEGMENT_EXISTS",
    );

    const closed = await closeRunSegment(
      { sessionId: session.id, closeReason: "Run complete", actorUserId: 1 },
      db,
    );
    assert.equal(closed.closed, true);
    assert.equal(closed.segment.status, "CLOSED");
    assert.ok(closed.segment.closedAt);
    assert.equal(closed.segment.closedByUserId, 1);
    assert.equal(closed.segment.closeReason, "Run complete");
    const originalClosedAt = closed.segment.closedAt;

    const again = await closeRunSegment(
      {
        sessionId: session.id,
        segmentId: closed.segment.id,
        closeReason: "retry overwrite attempt",
        actorUserId: 99,
      },
      db,
    );
    assert.equal(again.alreadyClosed, true);
    assert.equal(again.segment.closeReason, "Run complete");
    assert.equal(again.segment.closedByUserId, 1);
    assert.equal(again.segment.closedAt.getTime(), originalClosedAt.getTime());

    const second = await startRunSegment(
      { sessionId: session.id, runAllocationId: 200, actorUserId: 1 },
      db,
    );
    assert.equal(second.created, true);
    assert.equal(db._state.runSegments.length, 2);
  });

  it("requires a manual close reason and accepts controlled system reasons", async () => {
    const db = createMemoryDb();
    const session = await ready(db);
    await startRunSegment({ sessionId: session.id, runAllocationId: 200, actorUserId: 1 }, db);

    await assert.rejects(
      () => closeRunSegment({ sessionId: session.id, actorUserId: 1 }, db),
      /reason/i,
    );

    const closed = await closeRunSegment(
      {
        sessionId: session.id,
        closureSource: "SYSTEM",
        systemReason: "SHIFT_OVER",
        actorUserId: 1,
      },
      db,
    );
    assert.equal(closed.closed, true);
    assert.equal(closed.closureSource, "SYSTEM");
    assert.equal(closed.segment.closeReason, SYSTEM_CLOSE_REASON.SHIFT_OVER);
  });

  it("rejects terminal work orders without changing production services", async () => {
    const db = createMemoryDb({
      workOrders: [{ id: 50, status: "COMPLETED", docNo: "WO-R-26-0001" }],
    });
    const session = await ready(db);
    await assert.rejects(
      () => startRunSegment({ sessionId: session.id, workOrderId: 50, actorUserId: 1 }, db),
      /completed/i,
    );
  });
});

describe("downtime", () => {
  async function withActiveRun(db) {
    const session = await startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 100, isPrimary: true }],
      },
      db,
    );
    await startRunSegment({ sessionId: session.id, runAllocationId: 200, actorUserId: 1 }, db);
    return session;
  }

  it("pauses and resumes with server-calculated duration", async () => {
    const db = createMemoryDb();
    const session = await withActiveRun(db);
    const paused = await pauseForDowntime(
      { sessionId: session.id, reason: "MACHINE_BREAKDOWN", actorUserId: 1 },
      db,
    );
    assert.equal(paused.created, true);
    assert.equal(paused.incident.endedAt, null);
    assert.equal(paused.downtimeSegment.segmentEndAt, null);

    const start = new Date("2026-08-24T10:00:00.000Z");
    paused.downtimeSegment.segmentStartAt = start;
    paused.incident.startedAt = start;
    const segRow = db._state.downtimeSegments.find((s) => s.id === paused.downtimeSegment.id);
    const incRow = db._state.downtimeIncidents.find((i) => i.id === paused.incident.id);
    segRow.segmentStartAt = start;
    incRow.startedAt = start;

    const resumed = await resumeFromDowntime({ sessionId: session.id, actorUserId: 1 }, db);
    assert.equal(resumed.resumed, true);
    assert.ok(resumed.incident.endedAt);
    assert.equal(
      resumed.durationMinutes,
      durationMinutesFromTimestamps(resumed.downtimeSegment.segmentStartAt, resumed.downtimeSegment.segmentEndAt),
    );
    assert.equal(durationMinutesFromTimestamps(start, new Date(start.getTime() + 45 * 60000)), 45);
    // Client-provided duration must never be trusted / stored on rows
    assert.equal(Object.prototype.hasOwnProperty.call(resumed.downtimeSegment, "durationMinutes"), false);

    const idem = await resumeFromDowntime(
      { sessionId: session.id, incidentId: paused.incident.id, actorUserId: 1 },
      db,
    );
    assert.equal(idem.alreadyResumed, true);
  });

  it("continues unresolved downtime into next session without rewriting prior segment", async () => {
    const db = createMemoryDb();
    const session1 = await withActiveRun(db);
    const paused = await pauseForDowntime(
      { sessionId: session1.id, reason: "WAITING_FOR_RM", actorUserId: 1 },
      db,
    );
    const priorStart = new Date(paused.downtimeSegment.segmentStartAt);

    // Close session1 without resolving downtime (Shift Over is Step 2B — mark SHIFT_OVER manually for test)
    const s1 = db._state.sessions.find((s) => s.id === session1.id);
    s1.status = "SHIFT_OVER";
    const now = new Date();
    for (const part of db._state.sessionOperators.filter((r) => r.sessionId === session1.id && r.leftAt == null)) {
      part.leftAt = now;
      part.joinedLeaveReason = "SHIFT_OVER";
    }

    const session2 = await startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-25",
        operators: [{ operatorId: 100, isPrimary: true }],
      },
      db,
    );

    const continued = await continueDowntimeIntoSession(
      { sessionId: session2.id, incidentId: paused.incident.id },
      db,
    );
    assert.equal(continued.continued, true);
    assert.equal(continued.incident.endedAt, null);

    const prior = db._state.downtimeSegments.find((s) => s.id === paused.downtimeSegment.id);
    assert.ok(prior.segmentEndAt);
    assert.equal(prior.segmentStartAt.getTime(), priorStart.getTime());
    assert.notEqual(continued.downtimeSegment.id, prior.id);
    assert.equal(db._state.downtimeSegments.length, 2);
  });

  it("maps unique conflicts to domain errors", () => {
    const e = { code: "P2002", meta: { target: ["openMachId"] } };
    const mapped = mapShiftSessionPersistenceError(e, { action: "startSession" });
    assert.equal(mapped.code, "SHIFT_SESSION_ALREADY_OPEN");
    assert.equal(mapped.statusCode, 409);

    const opBusy = mapShiftSessionPersistenceError(
      { code: "P2002", meta: { target: ["activeOpId"] } },
      { action: "startSession" },
    );
    assert.equal(opBusy.code, "OPERATOR_ACTIVE_ON_ANOTHER_MACHINE");
  });
});
