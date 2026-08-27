/**
 * Server-authoritative live PE context: omitted runAllocationId cannot skip shift enforcement.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertNormalLiveProductionEntryAllowed,
  resolveLinkedShiftSessionForLiveGate,
  LIVE_GATE_CODES,
} = require("../../src/services/productionEntryLiveWindowService");

function makeDb({
  allocations = [],
  sessions = [],
  segments = [],
} = {}) {
  return {
    workOrderProductionRunAllocation: {
      findUnique: async ({ where }) => allocations.find((a) => a.id === where.id) || null,
      findMany: async ({ where } = {}) => {
        let rows = allocations.slice();
        if (where?.workOrderId != null) rows = rows.filter((a) => a.workOrderId === where.workOrderId);
        if (where?.isActive != null) rows = rows.filter((a) => a.isActive === where.isActive);
        return rows;
      },
    },
    machineShiftSession: {
      findUnique: async ({ where }) => sessions.find((s) => s.id === where.id) || null,
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = sessions.slice();
        if (where?.machineId != null) rows = rows.filter((s) => s.machineId === where.machineId);
        if (where?.status != null) rows = rows.filter((s) => s.status === where.status);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows[0] || null;
      },
      updateMany: async ({ where, data }) => {
        let rows = sessions.slice();
        if (where?.id != null) rows = rows.filter((s) => s.id === where.id);
        if (where?.status != null) rows = rows.filter((s) => s.status === where.status);
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    },
    machineShiftSessionRunSegment: {
      findMany: async ({ where } = {}) => {
        let rows = segments.slice();
        if (where?.workOrderId != null) rows = rows.filter((r) => r.workOrderId === where.workOrderId);
        if (where?.runAllocationId != null) {
          if (where.runAllocationId.in) {
            rows = rows.filter((r) => where.runAllocationId.in.includes(r.runAllocationId));
          } else {
            rows = rows.filter((r) => r.runAllocationId === where.runAllocationId);
          }
        }
        if (where?.status != null) rows = rows.filter((r) => r.status === where.status);
        if (where?.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        return rows.slice().sort((a, b) => b.id - a.id);
      },
    },
  };
}

const liveOpenSession = {
  id: 7,
  machineId: 1,
  status: "OPEN",
  shiftSessionNo: "SS-26-0100",
  scheduledStartAt: new Date("2026-08-26T00:30:00.000Z"),
  scheduledEndAt: new Date("2026-08-26T08:30:00.000Z"),
  graceMinutesSnapshot: 15,
};

const expiredOpenSession = {
  ...liveOpenSession,
  id: 8,
  shiftSessionNo: "SS-26-0101",
};

const handoverSession = {
  id: 9,
  machineId: 1,
  status: "HANDOVER_PENDING",
  shiftSessionNo: "SS-26-0102",
  scheduledStartAt: new Date("2026-08-26T00:30:00.000Z"),
  scheduledEndAt: new Date("2026-08-26T08:30:00.000Z"),
  graceMinutesSnapshot: 15,
  liveProductionStoppedAt: new Date("2026-08-26T08:45:00.000Z"),
};

const closedSession = {
  id: 10,
  machineId: 1,
  status: "SHIFT_OVER",
  shiftSessionNo: "SS-26-0103",
};

const alloc200 = { id: 200, workOrderId: 50, workOrderLineId: 10, fgItemId: 1, machineId: 1, isActive: true };
const alloc201 = { id: 201, workOrderId: 50, workOrderLineId: 10, fgItemId: 1, machineId: 2, isActive: true };

describe("productionEntry live-window context authority", () => {
  it("omitted runAllocationId cannot bypass an OPEN session past cutoff", async () => {
    const db = makeDb({
      allocations: [alloc200],
      sessions: [expiredOpenSession],
      segments: [
        { id: 3, sessionId: 8, machineId: 1, workOrderId: 50, runAllocationId: 200, status: "ACTIVE" },
      ],
    });
    await assert.rejects(
      () =>
        assertNormalLiveProductionEntryAllowed(db, {
          workOrderId: 50,
          workOrderLineId: 10,
          now: new Date("2026-08-26T14:20:00+05:30"),
        }),
      (e) => e.code === "SHIFT_LIVE_WINDOW_ENDED",
    );
  });

  it("omitted runAllocationId cannot bypass HANDOVER_PENDING", async () => {
    const db = makeDb({
      allocations: [alloc200],
      sessions: [handoverSession],
      segments: [
        { id: 3, sessionId: 9, machineId: 1, workOrderId: 50, runAllocationId: 200, status: "ACTIVE" },
      ],
    });
    await assert.rejects(
      () =>
        assertNormalLiveProductionEntryAllowed(db, {
          workOrderId: 50,
          now: new Date("2026-08-26T15:00:00+05:30"),
        }),
      (e) => e.code === "SHIFT_LIVE_WINDOW_ENDED",
    );
  });

  it("resolves a unique server match when runAllocationId is omitted", async () => {
    const db = makeDb({
      allocations: [alloc200],
      sessions: [liveOpenSession],
      segments: [
        { id: 3, sessionId: 7, machineId: 1, workOrderId: 50, runAllocationId: 200, status: "ACTIVE" },
      ],
    });
    const ok = await assertNormalLiveProductionEntryAllowed(db, {
      workOrderId: 50,
      now: new Date("2026-08-26T13:00:00+05:30"),
    });
    assert.equal(ok.skipped, false);
    assert.equal(ok.session.id, 7);
    assert.equal(ok.segment.id, 3);
    assert.equal(ok.runAllocationId, 200);
  });

  it("rejects ambiguous operational matches", async () => {
    const db = makeDb({
      allocations: [alloc200, alloc201],
      sessions: [
        liveOpenSession,
        { ...liveOpenSession, id: 17, machineId: 2, shiftSessionNo: "SS-26-0104" },
      ],
      segments: [
        { id: 3, sessionId: 7, machineId: 1, workOrderId: 50, runAllocationId: 200, status: "ACTIVE" },
        { id: 4, sessionId: 17, machineId: 2, workOrderId: 50, runAllocationId: 201, status: "ACTIVE" },
      ],
    });
    await assert.rejects(
      () => assertNormalLiveProductionEntryAllowed(db, { workOrderId: 50 }),
      (e) => e.code === LIVE_GATE_CODES.SHIFT_RUN_CONTEXT_AMBIGUOUS && e.statusCode === 409,
    );
  });

  it("rejects a client allocation that conflicts with the operational run", async () => {
    const db = makeDb({
      allocations: [alloc200, alloc201],
      sessions: [liveOpenSession],
      segments: [
        { id: 3, sessionId: 7, machineId: 1, workOrderId: 50, runAllocationId: 200, status: "ACTIVE" },
      ],
    });
    await assert.rejects(
      () =>
        assertNormalLiveProductionEntryAllowed(db, {
          workOrderId: 50,
          runAllocationId: 201,
          now: new Date("2026-08-26T13:00:00+05:30"),
        }),
      (e) => e.code === LIVE_GATE_CODES.SHIFT_RUN_CONTEXT_CONFLICT,
    );
  });

  it("rejects SHIFT_OVER / stale segment instead of treating it as legacy", async () => {
    const db = makeDb({
      allocations: [alloc200],
      sessions: [closedSession],
      segments: [
        { id: 3, sessionId: 10, machineId: 1, workOrderId: 50, runAllocationId: 200, status: "CLOSED" },
      ],
    });
    await assert.rejects(
      () => assertNormalLiveProductionEntryAllowed(db, { workOrderId: 50 }),
      (e) => e.code === LIVE_GATE_CODES.SHIFT_RUN_INACTIVE,
    );
  });

  it("allows genuine no-shift legacy PE when the server finds no linked run/session", async () => {
    const db = makeDb({
      allocations: [],
      sessions: [],
      segments: [],
    });
    const result = await assertNormalLiveProductionEntryAllowed(db, {
      workOrderId: 50,
      now: new Date("2026-08-26T13:00:00+05:30"),
    });
    assert.equal(result.skipped, true);
    const resolved = await resolveLinkedShiftSessionForLiveGate(db, { workOrderId: 50 });
    assert.equal(resolved.reason, "NO_SHIFT_LINKED_RUN");
  });

  it("does not treat a planned allocation without a shift segment as a live session", async () => {
    const db = makeDb({
      allocations: [alloc200],
      sessions: [],
      segments: [],
    });
    const result = await assertNormalLiveProductionEntryAllowed(db, {
      workOrderId: 50,
      runAllocationId: 200,
    });
    assert.equal(result.skipped, true);
  });
});
