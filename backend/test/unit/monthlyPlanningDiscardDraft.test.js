const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  discardMonthlyPlanDraft,
} = require("../../src/services/monthlyPlanningPlanLifecycleService");
const { MonthlyPlanningError } = require("../../src/services/monthlyPlanningService");

function createDiscardDb({ status = "DRAFT", currentRevision = 0, reopenedAt = null, linkedMr = false } = {}) {
  const state = {
    plan: {
      id: 7,
      docNo: "MPP-26-0007",
      periodKey: "2026-06",
      status,
      currentRevision,
      reopenedAt,
    },
    deleted: false,
    linkedMr,
  };

  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where }) => {
        if (where.id !== state.plan.id) return null;
        return { ...state.plan };
      },
      delete: async ({ where }) => {
        if (where.id === state.plan.id) state.deleted = true;
        return { ...state.plan };
      },
    },
    materialRequirement: {
      findFirst: async () => (state.linkedMr ? { id: 99 } : null),
    },
    $transaction: async (fn) => fn(db),
    __state: state,
  };

  return db;
}

describe("discardMonthlyPlanDraft", () => {
  it("deletes a DRAFT plan document", async () => {
    const db = createDiscardDb();
    const res = await discardMonthlyPlanDraft({ db, planId: 7, actorRole: "STORE" });
    assert.equal(res.discarded, true);
    assert.equal(res.periodKey, "2026-06");
    assert.equal(db.__state.deleted, true);
  });

  it("rejects AWAITING_PURCHASE_REVIEW", async () => {
    const db = createDiscardDb({ status: "AWAITING_PURCHASE_REVIEW" });
    await assert.rejects(
      () => discardMonthlyPlanDraft({ db, planId: 7, actorRole: "STORE" }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_DISCARDABLE",
    );
  });

  it("rejects APPROVED", async () => {
    const db = createDiscardDb({ status: "APPROVED" });
    await assert.rejects(
      () => discardMonthlyPlanDraft({ db, planId: 7, actorRole: "STORE" }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_DISCARDABLE",
    );
  });

  it("rejects legacy reopened draft", async () => {
    const db = createDiscardDb({
      status: "DRAFT",
      currentRevision: 2,
      reopenedAt: new Date("2026-06-01T00:00:00Z"),
    });
    await assert.rejects(
      () => discardMonthlyPlanDraft({ db, planId: 7, actorRole: "STORE" }),
      (e) => e instanceof MonthlyPlanningError && e.code === "USE_CANCEL_REOPEN",
    );
  });

  it("rejects when linked to material requirement", async () => {
    const db = createDiscardDb({ linkedMr: true });
    await assert.rejects(
      () => discardMonthlyPlanDraft({ db, planId: 7, actorRole: "STORE" }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_DISCARDABLE",
    );
  });
});
