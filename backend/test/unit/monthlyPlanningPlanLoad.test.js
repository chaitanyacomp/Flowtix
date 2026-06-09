const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { getMonthlyPlanByPeriod } = require("../../src/services/monthlyPlanningService");

describe("monthlyPlanning plan load (header discovery)", () => {
  it("returns plan header without joining production lines", async () => {
    const db = {
      monthlyProductionPlan: {
        findUnique: async ({ include }) => {
          assert.equal(include?.lines, undefined);
          return {
            id: 42,
            docNo: "MPP-26-0007",
            periodKey: "2026-07",
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
  });

  it("returns exists:false when no plan for period", async () => {
    const db = {
      monthlyProductionPlan: {
        findUnique: async () => null,
      },
    };
    const res = await getMonthlyPlanByPeriod({ db, period: "2026-07" });
    assert.equal(res.exists, false);
    assert.equal(res.plan, null);
  });
});
