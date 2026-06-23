const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { getMonthlyPlanByPeriod } = require("../../src/services/monthlyPlanningService");
const { selectPrimaryPlanForPeriod } = require("../../src/services/monthlyPlanningPlanLifecycleService");

describe("monthlyPlanning plan load (header discovery)", () => {
  it("selectPrimaryPlanForPeriod is available to getMonthlyPlanByPeriod (no circular-import gap)", () => {
    assert.equal(typeof selectPrimaryPlanForPeriod, "function");
  });

  it("returns plan header without joining production lines", async () => {
    const planRow = {
      id: 42,
      docNo: "MPP-26-0007",
      periodKey: "2026-07",
      planSequenceNo: 1,
      planKind: "INITIAL",
      status: "LOCKED",
      currentRevision: 1,
      remarks: null,
      lockedAt: new Date(),
      reopenedAt: null,
      releasedAt: null,
      releasedRevision: null,
      createdByUserId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      rmPlans: [{ revision: 1, recalculatedAt: new Date() }],
    };
    const db = {
      monthlyProductionPlan: {
        findMany: async ({ where, include, orderBy }) => {
          assert.equal(where.periodKey, "2026-07");
          assert.equal(include?.lines, undefined);
          assert.deepEqual(orderBy, { planSequenceNo: "asc" });
          return [planRow];
        },
      },
    };

    const res = await getMonthlyPlanByPeriod({ db, period: "2026-07" });
    assert.equal(res.exists, true);
    assert.equal(res.plan.id, 42);
    assert.equal(res.plan.periodKey, "2026-07");
    assert.equal(res.plan.status, "LOCKED");
    assert.deepEqual(res.lines, []);
    assert.equal(res.revisions.length, 1);
    assert.equal(res.plans.length, 1);
  });

  it("returns exists:false when no plan for period", async () => {
    const db = {
      monthlyProductionPlan: {
        findMany: async () => [],
      },
    };
    const res = await getMonthlyPlanByPeriod({ db, period: "2026-07" });
    assert.equal(res.exists, false);
    assert.equal(res.plan, null);
    assert.deepEqual(res.plans, []);
  });
});
