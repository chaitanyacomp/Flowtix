const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  businessTodayYmd,
  toBusinessYmd,
  isPastMachinePlanningStartDate,
  soEarliestAllowedPlannedStartYmd,
  canBackdateMachinePlanning,
  assertMachinePlanningPlannedDatesAllowed,
  writeMachinePlanningBackdateAudits,
} = require("../../src/services/machinePlanningBackdate");

describe("machinePlanningBackdate — calendar / timezone", () => {
  it("today/future succeeds normally (no reason)", () => {
    const today = businessTodayYmd(new Date("2026-08-26T12:00:00"));
    const out = assertMachinePlanningPlannedDatesAllowed({
      runs: [{ fgItemId: 1, runSequence: 1, machineId: 9, plannedDate: today }],
      actorRole: "PRODUCTION",
      backdateReason: "",
      salesOrder: { id: 1, createdAt: "2026-08-01T00:00:00.000Z" },
      existingRuns: [],
      now: new Date("2026-08-26T12:00:00"),
    });
    assert.equal(out.backdatedRuns.length, 0);
    assert.equal(out.reason, null);

    const future = assertMachinePlanningPlannedDatesAllowed({
      runs: [{ fgItemId: 1, runSequence: 1, machineId: 9, plannedDate: "2026-08-30" }],
      actorRole: "STORE",
      backdateReason: "",
      salesOrder: { id: 1, createdAt: "2026-08-01T00:00:00.000Z" },
      existingRuns: [],
      now: new Date("2026-08-26T12:00:00"),
    });
    assert.equal(future.backdatedRuns.length, 0);
  });

  it("timezone boundary: past vs today uses business calendar day", () => {
    // Late evening local — still "today" until midnight local.
    const now = new Date(2026, 7, 26, 23, 30, 0); // Aug 26 local
    assert.equal(businessTodayYmd(now), "2026-08-26");
    assert.equal(isPastMachinePlanningStartDate("2026-08-26", now), false);
    assert.equal(isPastMachinePlanningStartDate("2026-08-25", now), true);
    // Just after midnight → previous calendar day is past.
    const nextDay = new Date(2026, 7, 27, 0, 5, 0);
    assert.equal(isPastMachinePlanningStartDate("2026-08-26", nextDay), true);
  });

  it("date-only DB values use UTC YMD (no local shift)", () => {
    const d = new Date("2026-08-20T00:00:00.000Z");
    assert.equal(toBusinessYmd(d, { dateOnly: true }), "2026-08-20");
  });
});

describe("machinePlanningBackdate — authorization", () => {
  const so = { id: 42, createdAt: "2026-08-01T10:00:00.000Z", docNo: "SO-42" };
  const pastRun = { fgItemId: 1, runSequence: 1, machineId: 7, plannedDate: "2026-08-20" };
  const now = new Date("2026-08-26T12:00:00");

  it("Admin backdate with reason succeeds", () => {
    const out = assertMachinePlanningPlannedDatesAllowed({
      runs: [pastRun],
      actorRole: "ADMIN",
      backdateReason: "Missed planning entry",
      salesOrder: so,
      existingRuns: [],
      now,
    });
    assert.equal(out.backdatedRuns.length, 1);
    assert.equal(out.reason, "Missed planning entry");
  });

  it("Production Manager succeeds", () => {
    assert.equal(canBackdateMachinePlanning("PRODUCTION_MANAGER"), true);
    const out = assertMachinePlanningPlannedDatesAllowed({
      runs: [pastRun],
      actorRole: "PRODUCTION_MANAGER",
      backdateReason: "Catch-up plan",
      salesOrder: so,
      existingRuns: [],
      now,
    });
    assert.equal(out.backdatedRuns.length, 1);
  });

  it("missing reason blocks", () => {
    assert.throws(
      () =>
        assertMachinePlanningPlannedDatesAllowed({
          runs: [pastRun],
          actorRole: "ADMIN",
          backdateReason: "ab",
          salesOrder: so,
          existingRuns: [],
          now,
        }),
      (e) => e.code === "MACHINE_PLANNING_BACKDATE_REASON_REQUIRED",
    );
  });

  it("Production/Store blocked", () => {
    assert.throws(
      () =>
        assertMachinePlanningPlannedDatesAllowed({
          runs: [pastRun],
          actorRole: "PRODUCTION",
          backdateReason: "Should not matter",
          salesOrder: so,
          existingRuns: [],
          now,
        }),
      (e) => e.code === "MACHINE_PLANNING_BACKDATE_FORBIDDEN" && e.statusCode === 403,
    );
    assert.throws(
      () =>
        assertMachinePlanningPlannedDatesAllowed({
          runs: [pastRun],
          actorRole: "STORE",
          backdateReason: "Should not matter",
          salesOrder: so,
          existingRuns: [],
          now,
        }),
      (e) => e.code === "MACHINE_PLANNING_BACKDATE_FORBIDDEN",
    );
  });

  it("date before SO creation blocks", () => {
    assert.equal(soEarliestAllowedPlannedStartYmd(so), businessTodayYmd(new Date(so.createdAt)));
    assert.throws(
      () =>
        assertMachinePlanningPlannedDatesAllowed({
          runs: [{ ...pastRun, plannedDate: "2026-07-15" }],
          actorRole: "ADMIN",
          backdateReason: "Too early",
          salesOrder: so,
          existingRuns: [],
          now,
        }),
      (e) => e.code === "MACHINE_PLANNING_DATE_BEFORE_SO",
    );
  });

  it("unchanged historical past date remains editable without new reason", () => {
    const out = assertMachinePlanningPlannedDatesAllowed({
      runs: [pastRun],
      actorRole: "PRODUCTION",
      backdateReason: "",
      salesOrder: so,
      existingRuns: [{ fgItemId: 1, runSequence: 1, plannedDate: "2026-08-20T00:00:00.000Z" }],
      now,
    });
    assert.equal(out.backdatedRuns.length, 0);
  });
});

describe("machinePlanningBackdate — audit", () => {
  it("audit recorded with user, enteredAt, plannedStartDate, reason, SO and machine", async () => {
    const created = [];
    const tx = {
      auditLog: {
        create: async ({ data }) => {
          created.push(data);
          return { id: created.length };
        },
      },
    };
    await writeMachinePlanningBackdateAudits(tx, {
      salesOrderId: 42,
      salesOrderDocNo: "SO-42",
      actorUserId: 9,
      actorRole: "ADMIN",
      reason: "Missed planning entry",
      backdatedRuns: [{ fgItemId: 1, runSequence: 1, machineId: 7, plannedDate: "2026-08-20" }],
      enteredAt: new Date("2026-08-26T10:00:00.000Z"),
    });
    assert.equal(created.length, 1);
    assert.equal(created[0].entityType, "SALES_ORDER");
    assert.equal(created[0].entityId, "42");
    assert.equal(created[0].actorUserId, 9);
    assert.equal(created[0].reason, "Missed planning entry");
    assert.equal(created[0].payload.kind, "MACHINE_PLANNING_BACKDATE");
    assert.equal(created[0].payload.plannedStartDate, "2026-08-20");
    assert.equal(created[0].payload.machineId, 7);
    assert.equal(created[0].payload.salesOrderId, 42);
    assert.equal(created[0].payload.enteredAt, "2026-08-26T10:00:00.000Z");
  });
});
