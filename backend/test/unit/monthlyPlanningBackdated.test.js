const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getCurrentPeriodKey,
  isPastPlanningPeriod,
  isPastPeriod,
  PAST_PERIOD_PLANNING_MESSAGE,
  assertPeriodWriteAllowed,
  createMonthlyPlan,
  reopenMonthlyPlan,
  cancelReopenMonthlyPlan,
  updateProductionLines,
  lockMonthlyPlan,
  getMonthlyPlanByPeriod,
  MonthlyPlanningError,
} = require("../../src/services/monthlyPlanningService");
const { getRequirementComposition } = require("../../src/services/monthlyPlanningRequirementCompositionService");

/** Current month = 2026-07 per Phase 8D-B examples. */
const FIXED_NOW = new Date("2026-07-15T12:00:00Z");

function expectPastPeriodBlocked(promise) {
  return assert.rejects(
    promise,
    (e) =>
      e instanceof MonthlyPlanningError &&
      e.code === "PAST_PERIOD_PLANNING_NOT_ALLOWED" &&
      e.httpStatus === 403 &&
      e.message === PAST_PERIOD_PLANNING_MESSAGE,
  );
}

describe("monthlyPlanning isPastPlanningPeriod", () => {
  it("getCurrentPeriodKey uses local calendar month", () => {
    assert.equal(getCurrentPeriodKey(FIXED_NOW), "2026-07");
  });

  it("isPastPlanningPeriod treats periodKey < current YYYY-MM as past", () => {
    assert.equal(isPastPlanningPeriod("2026-06", FIXED_NOW), true);
    assert.equal(isPastPlanningPeriod("2026-05", FIXED_NOW), true);
    assert.equal(isPastPlanningPeriod("2025-12", FIXED_NOW), true);
    assert.equal(isPastPlanningPeriod("2026-07", FIXED_NOW), false);
    assert.equal(isPastPlanningPeriod("2026-08", FIXED_NOW), false);
    assert.equal(isPastPeriod("2026-06", FIXED_NOW), true);
  });

  it("current and future months work for STORE without confirmation", () => {
    assert.equal(assertPeriodWriteAllowed({ periodKey: "2026-07", actorRole: "STORE", now: FIXED_NOW }), "2026-07");
    assert.equal(assertPeriodWriteAllowed({ periodKey: "2026-09", actorRole: "STORE", now: FIXED_NOW }), "2026-09");
  });

  it("STORE past period returns PAST_PERIOD_PLANNING_NOT_ALLOWED", () => {
    assert.throws(
      () => assertPeriodWriteAllowed({ periodKey: "2026-06", actorRole: "STORE", now: FIXED_NOW }),
      (e) =>
        e instanceof MonthlyPlanningError &&
        e.code === "PAST_PERIOD_PLANNING_NOT_ALLOWED" &&
        e.message === PAST_PERIOD_PLANNING_MESSAGE,
    );
  });

  it("ADMIN past period requires confirmPastPeriod", () => {
    assert.throws(
      () => assertPeriodWriteAllowed({ periodKey: "2026-06", actorRole: "ADMIN", now: FIXED_NOW }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PAST_PERIOD_CONFIRM_REQUIRED",
    );
    assert.equal(
      assertPeriodWriteAllowed({
        periodKey: "2026-06",
        actorRole: "ADMIN",
        confirmPastPeriod: true,
        now: FIXED_NOW,
      }),
      "2026-06",
    );
  });
});

function createBackdatedDb({
  periodKey = "2026-06",
  status = "LOCKED",
  currentRevision = 1,
  reopenedAt = null,
  snapshotLines = [],
} = {}) {
  const state = {
    plan: {
      id: 1,
      docNo: "MPP-26-0001",
      periodKey,
      status,
      currentRevision,
      remarks: null,
      lockedAt: new Date("2026-06-30T10:00:00Z"),
      lockedByUserId: 9,
      reopenedAt,
      reopenedByUserId: reopenedAt ? 5 : null,
      releasedAt: null,
      releasedRevision: null,
      createdByUserId: 7,
      createdAt: new Date("2026-06-01T00:00:00Z"),
      updatedAt: new Date("2026-06-30T10:00:00Z"),
    },
    liveLines: [
      {
        id: 11,
        planId: 1,
        fgItemId: 10,
        suggestedFgQty: 1000,
        plannedFgQty: 1000,
        plannedQtyOverridden: false,
        source: "MANUAL",
        remarks: null,
      },
    ],
    snapshotLines: snapshotLines.length
      ? snapshotLines
      : [
          {
            planId: 1,
            revision: currentRevision,
            fgItemId: 10,
            suggestedFgQty: 1000,
            plannedFgQty: 1000,
            plannedQtyOverridden: false,
            source: "MANUAL",
            remarks: null,
          },
        ],
    writes: [],
  };

  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where, select }) => {
        if (where.periodKey && where.periodKey !== state.plan.periodKey) return null;
        if (where.id && where.id !== state.plan.id) return null;
        const row = { ...state.plan };
        if (select) {
          const picked = {};
          for (const key of Object.keys(select)) {
            if (select[key] && row[key] !== undefined) picked[key] = row[key];
          }
          return picked;
        }
        return row;
      },
      create: async ({ data }) => {
        state.writes.push({ type: "plan.create", data });
        const created = {
          id: 99,
          lines: [],
          createdAt: new Date("2026-06-01T00:00:00Z"),
          updatedAt: new Date("2026-06-01T00:00:00Z"),
          lockedAt: null,
          reopenedAt: null,
          releasedAt: null,
          releasedRevision: null,
          ...data,
        };
        state.plan = created;
        return created;
      },
      update: async ({ data }) => {
        state.writes.push({ type: "plan.update", data });
        Object.assign(state.plan, data);
        return { ...state.plan };
      },
    },
    monthlyProductionPlanLine: {
      findMany: async () => state.liveLines.map((l) => ({ ...l, fgItem: { itemName: "Cap", unit: "NOS" } })),
      deleteMany: async () => {
        state.liveLines = [];
        return { count: 1 };
      },
      createMany: async ({ data }) => {
        state.liveLines = data.map((d, i) => ({ id: 20 + i, ...d }));
        return { count: data.length };
      },
      upsert: async () => ({}),
    },
    monthlyProductionPlanRevisionLine: {
      findMany: async ({ where }) =>
        state.snapshotLines.filter(
          (l) => l.planId === where.planId && l.revision === where.revision,
        ),
    },
    docSequence: {
      upsert: async () => ({ nextNumber: 2, year2: 26, docType: "MONTHLY_PRODUCTION_PLAN" }),
    },
    item: {
      findMany: async () => [{ id: 10, itemType: "FG" }],
    },
    $transaction: async (fn) => fn(db),
    __state: state,
  };
  return db;
}

const emptyCompositionLoader = async () => ({ periodKey: "2026-06", items: [] });
const emptyGreenLoader = async () => ({ anchorPeriodKey: "2026-06", items: [] });

describe("monthlyPlanning Phase 8D-B STORE past-period guards", () => {
  it("STORE cannot create draft for past period", async () => {
    const db = createBackdatedDb();
    db.monthlyProductionPlan.findUnique = async ({ where }) => (where.periodKey ? null : db.__state.plan);
    await expectPastPeriodBlocked(
      createMonthlyPlan({ db, period: "2026-06", actorRole: "STORE", now: FIXED_NOW }),
    );
    assert.equal(db.__state.writes.length, 0);
  });

  it("STORE cannot save draft for past period", async () => {
    const db = createBackdatedDb({ periodKey: "2026-06", status: "DRAFT", currentRevision: 0 });
    await expectPastPeriodBlocked(
      updateProductionLines({
        db,
        planId: 1,
        upserts: [{ fgItemId: 10, plannedFgQty: 500 }],
        actorRole: "STORE",
        now: FIXED_NOW,
        loadComposition: emptyCompositionLoader,
        loadGreenLevelsFn: emptyGreenLoader,
      }),
    );
  });

  it("STORE cannot lock past period", async () => {
    const db = createBackdatedDb({ periodKey: "2026-06", status: "DRAFT", currentRevision: 0 });
    await expectPastPeriodBlocked(
      lockMonthlyPlan({ db, planId: 1, actorRole: "STORE", asOf: FIXED_NOW }),
    );
  });

  it("STORE cannot reopen past period", async () => {
    const db = createBackdatedDb({ periodKey: "2026-06", status: "LOCKED", currentRevision: 2 });
    await expectPastPeriodBlocked(
      reopenMonthlyPlan({ db, planId: 1, actorRole: "STORE", asOf: FIXED_NOW }),
    );
    assert.equal(db.__state.plan.status, "LOCKED");
  });

  it("STORE cannot cancel reopen on past period", async () => {
    const db = createBackdatedDb({
      periodKey: "2026-06",
      status: "DRAFT",
      currentRevision: 2,
      reopenedAt: new Date("2026-07-01T10:00:00Z"),
    });
    await expectPastPeriodBlocked(
      cancelReopenMonthlyPlan({ db, planId: 1, actorRole: "STORE", now: FIXED_NOW }),
    );
  });

  it("STORE can view past period (GET by period)", async () => {
    const db = createBackdatedDb({ periodKey: "2026-06" });
    const res = await getMonthlyPlanByPeriod({ db, period: "2026-06" });
    assert.equal(res.exists, true);
    assert.equal(res.plan.periodKey, "2026-06");
    assert.equal(db.__state.writes.length, 0);
  });
});

describe("monthlyPlanning Phase 8D-B ADMIN and read-only paths", () => {
  it("ADMIN can create after confirmation path", async () => {
    const db = createBackdatedDb();
    db.monthlyProductionPlan.findUnique = async ({ where }) => (where.periodKey ? null : db.__state.plan);
    const res = await createMonthlyPlan({
      db,
      period: "2026-06",
      actorRole: "ADMIN",
      confirmPastPeriod: true,
      now: FIXED_NOW,
    });
    assert.equal(res.plan.status, "DRAFT");
    assert.equal(res.plan.periodKey, "2026-06");
  });

  it("ADMIN can reopen past period with confirmation", async () => {
    const db = createBackdatedDb({ periodKey: "2026-06", status: "LOCKED", currentRevision: 2 });
    const res = await reopenMonthlyPlan({
      db,
      planId: 1,
      actorRole: "ADMIN",
      confirmPastPeriod: true,
      asOf: FIXED_NOW,
    });
    assert.equal(res.status, "DRAFT");
    assert.equal(db.__state.plan.status, "DRAFT");
  });

  it("current month still works for STORE create", async () => {
    const db = createBackdatedDb({ periodKey: "2026-07" });
    db.monthlyProductionPlan.findUnique = async ({ where }) => (where.periodKey ? null : db.__state.plan);
    const res = await createMonthlyPlan({
      db,
      period: "2026-07",
      actorRole: "STORE",
      now: FIXED_NOW,
    });
    assert.equal(res.plan.periodKey, "2026-07");
    assert.equal(res.plan.status, "DRAFT");
  });

  it("future month still works for STORE create", async () => {
    const db = createBackdatedDb({ periodKey: "2026-09" });
    db.monthlyProductionPlan.findUnique = async ({ where }) => (where.periodKey ? null : db.__state.plan);
    const res = await createMonthlyPlan({
      db,
      period: "2026-09",
      actorRole: "STORE",
      now: FIXED_NOW,
    });
    assert.equal(res.plan.periodKey, "2026-09");
  });

  it("read-only composition API still works for past period", async () => {
    const db = createBackdatedDb();
    const res = await getRequirementComposition({
      db,
      periodKey: "2026-06",
      loadRsSuggestions: async () => ({ periodKey: "2026-06", sheetCount: 0, items: [] }),
      loadGreenLevels: async () => ({ anchorPeriodKey: "2026-06", items: [] }),
    });
    assert.equal(res.periodKey, "2026-06");
    assert.ok(Array.isArray(res.items));
    assert.equal(db.__state.writes.length, 0);
  });
});
