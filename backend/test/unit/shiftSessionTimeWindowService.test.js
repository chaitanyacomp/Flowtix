/**
 * Authoritative IST schedule / grace / live-cutoff math (no database).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildScheduledWindow,
  evaluateStartWindow,
  resolveLiveCutoff,
  evaluateLiveWindow,
  reconcileSessionExpiry,
  SESSION_STATUS,
} = require("../../src/services/shiftSessionTimeWindowService");

describe("shiftSessionTimeWindowService — schedules", () => {
  it("maps 8-hour Morning A 06:00–14:00 IST to UTC DATETIME components", () => {
    const w = buildScheduledWindow({
      sessionDate: "2026-08-26",
      startTime: "06:00",
      endTime: "14:00",
    });
    assert.equal(w.isOvernight, false);
    assert.equal(w.scheduledStartAt.toISOString(), "2026-08-26T00:30:00.000Z");
    assert.equal(w.scheduledEndAt.toISOString(), "2026-08-26T08:30:00.000Z");
  });

  it("maps overnight 8-hour 22:00–06:00 with end on the next calendar date", () => {
    const w = buildScheduledWindow({
      sessionDate: "2026-08-26",
      startTime: "22:00",
      endTime: "06:00",
    });
    assert.equal(w.isOvernight, true);
    assert.equal(w.endYmd, "2026-08-27");
    assert.equal(w.scheduledStartAt.toISOString(), "2026-08-26T16:30:00.000Z");
    assert.equal(w.scheduledEndAt.toISOString(), "2026-08-27T00:30:00.000Z");
  });

  it("maps overnight 12-hour 18:00–06:00", () => {
    const w = buildScheduledWindow({
      sessionDate: "2026-08-26",
      startTime: "18:00",
      endTime: "06:00",
    });
    assert.equal(w.isOvernight, true);
    assert.equal(w.scheduledStartAt.toISOString(), "2026-08-26T12:30:00.000Z");
    assert.equal(w.scheduledEndAt.toISOString(), "2026-08-27T00:30:00.000Z");
  });

  it("never infers sessionDate from current time", () => {
    const w = buildScheduledWindow({
      sessionDate: "2026-01-01",
      startTime: "06:00",
      endTime: "14:00",
    });
    assert.equal(w.startYmd, "2026-01-01");
    assert.notEqual(w.startYmd, new Date().toISOString().slice(0, 10));
  });
});

describe("shiftSessionTimeWindowService — start window ± grace", () => {
  const start = new Date("2026-08-26T00:30:00.000Z"); // 06:00 IST

  it("allows early and late start inside 15-minute grace", () => {
    const early = evaluateStartWindow(start, 15, new Date("2026-08-26T05:50:00+05:30"));
    assert.equal(early.withinStartWindow, true);
    assert.equal(early.side, null);

    const late = evaluateStartWindow(start, 15, new Date("2026-08-26T06:10:00+05:30"));
    assert.equal(late.withinStartWindow, true);
  });

  it("rejects start outside ± grace", () => {
    const tooEarly = evaluateStartWindow(start, 15, new Date("2026-08-26T05:44:00+05:30"));
    assert.equal(tooEarly.withinStartWindow, false);
    assert.equal(tooEarly.side, "EARLY");

    const tooLate = evaluateStartWindow(start, 15, new Date("2026-08-26T06:16:00+05:30"));
    assert.equal(tooLate.withinStartWindow, false);
    assert.equal(tooLate.side, "LATE");
  });
});

describe("shiftSessionTimeWindowService — live cutoff and overtime", () => {
  const scheduledEndAt = new Date("2026-08-26T08:30:00.000Z"); // 14:00 IST

  it("uses scheduledEndAt + grace when overtime is absent", () => {
    const cutoff = resolveLiveCutoff({ scheduledEndAt, graceMinutesSnapshot: 15 });
    assert.equal(cutoff.toISOString(), "2026-08-26T08:45:00.000Z");
  });

  it("uses overtimeApprovedUntil when it is later than the normal cutoff", () => {
    const overtime = new Date("2026-08-26T16:00:00+05:30");
    const cutoff = resolveLiveCutoff({
      scheduledEndAt,
      graceMinutesSnapshot: 15,
      overtimeApprovedUntil: overtime,
    });
    assert.equal(cutoff.toISOString(), overtime.toISOString());
  });

  it("ignores overtime that is not later than the normal cutoff", () => {
    const cutoff = resolveLiveCutoff({
      scheduledEndAt,
      graceMinutesSnapshot: 15,
      overtimeApprovedUntil: new Date("2026-08-26T14:10:00+05:30"),
    });
    assert.equal(cutoff.toISOString(), "2026-08-26T08:45:00.000Z");
  });

  it("marks withinEndGrace only between scheduled end and normal cutoff", () => {
    const session = { scheduledStartAt: new Date("2026-08-26T00:30:00.000Z"), scheduledEndAt, graceMinutesSnapshot: 15 };
    const inGrace = evaluateLiveWindow(session, new Date("2026-08-26T14:05:00+05:30"));
    assert.equal(inGrace.withinEndGrace, true);
    assert.equal(inGrace.liveOpen, true);
    const afterGrace = evaluateLiveWindow(session, new Date("2026-08-26T14:16:00+05:30"));
    assert.equal(afterGrace.withinEndGrace, false);
    assert.equal(afterGrace.liveOpen, false);
  });
});

describe("shiftSessionTimeWindowService — expiry idempotency", () => {
  function memoryTx(session) {
    const rows = [session];
    return {
      machineShiftSession: {
        updateMany: async ({ where, data }) => {
          const match = rows.filter((s) => s.id === where.id && s.status === where.status);
          for (const row of match) Object.assign(row, data);
          return { count: match.length };
        },
        findUnique: async ({ where }) => rows.find((s) => s.id === where.id) || null,
      },
      _rows: rows,
    };
  }

  it("OPEN past cutoff becomes HANDOVER_PENDING with cutoff stamp, not detection time", async () => {
    const cutoff = new Date("2026-08-26T08:45:00.000Z");
    const detected = new Date("2026-08-26T18:00:00+05:30");
    const session = {
      id: 1,
      status: "OPEN",
      scheduledEndAt: new Date("2026-08-26T08:30:00.000Z"),
      graceMinutesSnapshot: 15,
      liveProductionStoppedAt: null,
      timeEndDetectedAt: null,
      actualOperationalEndAt: null,
    };
    const tx = memoryTx(session);
    const after = await reconcileSessionExpiry(tx, session, detected);
    assert.equal(after.status, SESSION_STATUS.HANDOVER_PENDING);
    assert.equal(after.liveProductionStoppedAt.toISOString(), cutoff.toISOString());
    assert.equal(after.timeEndDetectedAt.toISOString(), detected.toISOString());
    assert.equal(after.actualOperationalEndAt, null);
  });

  it("repeated and concurrent expiry calls do not rewrite stamps", async () => {
    const cutoff = new Date("2026-08-26T08:45:00.000Z");
    const firstDetect = new Date("2026-08-26T15:00:00+05:30");
    const session = {
      id: 2,
      status: "OPEN",
      scheduledEndAt: new Date("2026-08-26T08:30:00.000Z"),
      graceMinutesSnapshot: 15,
      liveProductionStoppedAt: null,
      timeEndDetectedAt: null,
      actualOperationalEndAt: null,
    };
    const tx = memoryTx(session);
    await reconcileSessionExpiry(tx, session, firstDetect);
    const later = new Date("2026-08-26T20:00:00+05:30");
    const again = await reconcileSessionExpiry(tx, { ...session }, later);
    assert.equal(again.status, SESSION_STATUS.HANDOVER_PENDING);
    assert.equal(again.liveProductionStoppedAt.toISOString(), cutoff.toISOString());
    assert.equal(again.timeEndDetectedAt.toISOString(), firstDetect.toISOString());

    const concurrent = await reconcileSessionExpiry(
      tx,
      { ...session, status: "OPEN", liveProductionStoppedAt: null, timeEndDetectedAt: null },
      later,
    );
    assert.equal(concurrent.status, SESSION_STATUS.HANDOVER_PENDING);
    assert.equal(concurrent.liveProductionStoppedAt.toISOString(), cutoff.toISOString());
    assert.equal(concurrent.timeEndDetectedAt.toISOString(), firstDetect.toISOString());
  });
});
